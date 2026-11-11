import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { afterHireFormSaved } from '@/lib/submission-server'
import { recomputeProfileStatus } from '@/lib/hire-status'
import { z } from 'zod'
import { FIELD_LIMITS } from '@/lib/field-limits'
import { zName, firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'

// The typed signature: a name, up to 100 characters, stored as plain text
const BodySchema = z.strictObject({ signature: zName('Signature', FIELD_LIMITS.signature) })

export async function POST(request: Request) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = BodySchema.safeParse(read.data)
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error).message, field: 'signature' }, { status: 400 })
  const { signature } = parsed.data

  const admin = createServiceClient()

  const { error } = await admin
    .from('policy_acknowledgements')
    .upsert({
      user_id:     user.id,
      signature,
      agreed_at:   new Date().toISOString(),
      form_status:  'review',
      flag_reason:  null,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) {
    console.error(`policy_acknowledgements upsert failed (code ${error.code})`)
    return NextResponse.json({ error: 'Failed to save. Please try again.' }, { status: 500 })
  }

  await recomputeProfileStatus(admin, user.id)

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'green',
    message:      '<strong>New hire</strong> submitted the policy acknowledgement',
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
    .from('policy_acknowledgements')
    .select('signature, form_status, flag_reason')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return NextResponse.json({ existing: null })

  return NextResponse.json({
    existing: { signature: data.signature, formStatus: data.form_status, flagReason: data.flag_reason ?? null },
  })
}
