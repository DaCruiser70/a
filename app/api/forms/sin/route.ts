import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { afterHireFormSaved } from '@/lib/submission-server'
import { encrypt, decrypt } from '@/lib/encrypt'
import { recomputeProfileStatus } from '@/lib/hire-status'
import { z } from 'zod'
import { zSin, firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'

// 9 digits (spaces and dashes removed) with the standard SIN checksum. Encrypted exactly as before;
// the value is never logged, echoed or written to the audit log.
const BodySchema = z.strictObject({ sin: zSin() })

export async function POST(request: Request) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = BodySchema.safeParse(read.data)
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error).message, field: 'sin' }, { status: 400 })
  const sinDigits = parsed.data.sin

  const admin = createServiceClient()

  const { error } = await admin
    .from('sin_info')
    .upsert({
      user_id:     user.id,
      sin_enc:     encrypt(sinDigits),
      form_status:  'review',
      flag_reason:  null,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) {
    console.error(`sin_info upsert failed (code ${error.code})`)
    return NextResponse.json({ error: 'Failed to save. Please try again.' }, { status: 500 })
  }

  await recomputeProfileStatus(admin, user.id)

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'navy',
    message:      '<strong>New hire</strong> submitted Social Insurance Number',
    performed_by: user.id,
  })

  // Sent to HR on save; the save that completes every required form queues HR's notice once
  const { complete, justCompleted } = await afterHireFormSaved(admin, user.id)

  return NextResponse.json({ ok: true, complete, justCompleted })
}

export async function GET() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()
  const { data } = await admin
    .from('sin_info')
    .select('sin_enc, form_status, flag_reason')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return NextResponse.json({ existing: null })

  let sin = ''
  try { sin = decrypt(data.sin_enc) } catch { /* key mismatch or corrupted data */ }

  return NextResponse.json({
    existing: { sin, formStatus: data.form_status, flagReason: data.flag_reason ?? null },
  })
}
