import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { afterHireFormSaved } from '@/lib/submission-server'
import { recomputeProfileStatus } from '@/lib/hire-status'
import { encryptFields, decryptFields } from '@/lib/encrypt'
import { esc } from '@/lib/safe-html'
import { EMERGENCY_RELATIONSHIPS, PHONE_CHOICES, WORK_PHONE_PLATFORMS } from '@/lib/personal-info'
import { FIELD_LIMITS, normalizePhone } from '@/lib/field-limits'
import { PHONE_ERROR } from '@/lib/phone-format'
import {
  zName, zText, zEmail, zPhone, zPostalCode, zProvince, zDateOfBirth, firstIssue, readJsonBody,
  BODY_TOO_LARGE, INVALID_REQUEST,
} from '@/lib/field-validation'

// Every field: cleaned, length-limited and format-checked here (lib/field-limits.ts). Phones are
// stored as 10 digits and postal codes as A1A 1A1. Messages name the field, never the value.
const BodySchema = z.strictObject({
  firstName:             zName('First name'),
  lastName:              zName('Last name'),
  dateOfBirth:           zDateOfBirth(),
  phone:                 zPhone(),
  email:                 zEmail('Email'),
  street:                zText('Street address', FIELD_LIMITS.address),
  city:                  zText('City', FIELD_LIMITS.city),
  province:              zProvince,
  postalCode:            zPostalCode(),
  emergencyName:         zName('Emergency contact name'),
  emergencyRelationship: z.enum(EMERGENCY_RELATIONSHIPS, { error: 'Choose the emergency contact’s relationship from the list.' }),
  emergencyPhone:        zPhone(),
  phoneChoice:           z.enum(PHONE_CHOICES, { error: 'Choose a company work phone or your personal phone.' }),
  workPhonePlatform:     z.enum(WORK_PHONE_PLATFORMS).nullable().optional(),
  personalPhone:         z.string().max(FIELD_LIMITS.phoneInput * 2).nullable().optional(),
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

  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = BodySchema.safeParse(read.data)
  if (!parsed.success) {
    // The field and a friendly message, so the form can say what to fix; never the value
    const { field, message } = firstIssue(parsed.error)
    return NextResponse.json({ error: message, field }, { status: 400 })
  }
  const body = parsed.data

  // Only the chosen branch is kept; the other is cleared on save
  const workPlatform  = body.phoneChoice === 'work' ? body.workPhonePlatform ?? null : null
  if (body.phoneChoice === 'work' && !workPlatform) {
    return NextResponse.json({ error: 'Choose Apple or Android for your work phone.', field: 'workPhonePlatform' }, { status: 400 })
  }
  let personalPhone: string | null = null
  if (body.phoneChoice === 'personal') {
    personalPhone = normalizePhone(body.personalPhone ?? '')
    if (!personalPhone) {
      return NextResponse.json({ error: PHONE_ERROR, field: 'personalPhone' }, { status: 400 })
    }
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
