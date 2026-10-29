import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { afterHireFormSaved } from '@/lib/submission-server'
import { recomputeProfileStatus } from '@/lib/hire-status'
import { encryptFields, decryptFields } from '@/lib/encrypt'
import { esc } from '@/lib/safe-html'
import {
  PROVINCES, EMERGENCY_RELATIONSHIPS, PHONE_CHOICES, WORK_PHONE_PLATFORMS, PHONE_MAX, phoneError, dobError,
} from '@/lib/personal-info'

const text  = (max: number) => z.string().trim().min(1).max(max)
const phone = z.string().trim().max(PHONE_MAX).refine(v => phoneError(v) === null)

const BodySchema = z.strictObject({
  firstName:             text(100),
  lastName:              text(100),
  dateOfBirth:           z.string().trim().max(10).refine(v => dobError(v) === null),
  phone,
  email:                 z.email().max(254),
  street:                text(200),
  city:                  text(100),
  province:              z.enum(PROVINCES),
  postalCode:            text(10),
  emergencyName:         text(200),
  emergencyRelationship: z.enum(EMERGENCY_RELATIONSHIPS),
  emergencyPhone:        phone,
  phoneChoice:           z.enum(PHONE_CHOICES),
  workPhonePlatform:     z.enum(WORK_PHONE_PLATFORMS).nullable().optional(),
  personalPhone:         z.string().max(PHONE_MAX).nullable().optional(),
})

export async function POST(request: Request) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('forms:personal', user.id), 20, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    // Field names only, so the form can say which answer to fix; never the values
    const field = parsed.error.issues[0]?.path[0]
    const dob   = (raw as { dateOfBirth?: unknown } | null)?.dateOfBirth
    const message =
      field === 'dateOfBirth' ? dobError(typeof dob === 'string' ? dob : '') ?? 'Enter a valid date of birth.'
      : field === 'phone' || field === 'emergencyPhone' ? 'Enter a valid phone number, for example (905) 555-0100.'
      : field === 'phoneChoice' ? 'Choose a company work phone or your personal phone.'
      : 'Please fill in all required fields.'
    return NextResponse.json({ error: message }, { status: 400 })
  }
  const body = parsed.data

  // Only the chosen branch is kept; the other is cleared on save
  const workPlatform  = body.phoneChoice === 'work' ? body.workPhonePlatform ?? null : null
  const personalPhone = body.phoneChoice === 'personal' ? (body.personalPhone ?? '').trim() : null
  if (body.phoneChoice === 'work' && !workPlatform) {
    return NextResponse.json({ error: 'Choose Apple or Android for your work phone.' }, { status: 400 })
  }
  if (body.phoneChoice === 'personal' && phoneError(personalPhone ?? '') !== null) {
    return NextResponse.json({ error: 'Enter a valid personal phone number, for example (905) 555-0100.' }, { status: 400 })
  }

  const fields = {
    first_name:             body.firstName,
    last_name:              body.lastName,
    date_of_birth:          body.dateOfBirth,
    phone:                  body.phone,
    personal_email:         body.email,
    street:                 body.street,
    city:                   body.city,
    province:               body.province,
    postal_code:            body.postalCode,
    emergency_name:         body.emergencyName,
    emergency_relationship: body.emergencyRelationship,
    emergency_phone:        body.emergencyPhone,
    phone_choice:           body.phoneChoice,
    work_phone_platform:    workPlatform,
    personal_phone:         personalPhone,
  }

  const admin = createServiceClient()

  const { error } = await admin
    .from('personal_info')
    .upsert(encryptFields({
      user_id:      user.id,
      ...fields,
      form_status:  'review' as const,
      flag_reason:  null,
      submitted_at: new Date().toISOString(),
    }), { onConflict: 'user_id' })

  if (error) {
    // Postgres error messages can echo submitted values — log the code only
    console.error(`personal_info upsert failed (code ${error.code})`)
    return NextResponse.json({ error: 'Failed to save. Please try again.' }, { status: 500 })
  }

  await recomputeProfileStatus(admin, user.id)

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'navy',
    message:      `<strong>${esc(fields.first_name)} ${esc(fields.last_name)}</strong> submitted personal information`,
    performed_by: user.id,
  })

  // Sent to HR on save; the save that completes every required form queues HR's notice once
  const { complete, justCompleted } = await afterHireFormSaved(admin, user.id)

  return NextResponse.json({ ok: true, complete, justCompleted })
}

// Returns the signed-in user's own row, decrypted, for pre-filling the form
export async function GET() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()
  const { data: row } = await admin
    .from('personal_info')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!row) return NextResponse.json({ existing: null })

  const data = decryptFields(row)

  return NextResponse.json({
    existing: {
      firstName:             data.first_name,
      lastName:              data.last_name,
      dateOfBirth:           data.date_of_birth,
      phone:                 data.phone,
      email:                 data.personal_email,
      street:                data.street,
      city:                  data.city,
      province:              data.province,
      postalCode:            data.postal_code,
      emergencyName:         data.emergency_name,
      emergencyRelationship: data.emergency_relationship,
      emergencyPhone:        data.emergency_phone,
      phoneChoice:           data.phone_choice ?? null,
      workPhonePlatform:     data.work_phone_platform ?? null,
      personalPhone:         data.personal_phone ?? null,
      formStatus:            data.form_status,
      flagReason:            data.flag_reason ?? null,
    },
  })
}
