import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { recomputeProfileStatus } from '@/lib/hire-status'

export async function POST(request: Request) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { signature } = await request.json()
  if (!signature?.trim()) {
    return NextResponse.json({ error: 'Signature is required.' }, { status: 400 })
  }

  const admin = createServiceClient()

  const { error } = await admin
    .from('policy_acknowledgements')
    .upsert({
      user_id:     user.id,
      signature:   signature.trim(),
      agreed_at:   new Date().toISOString(),
      form_status:  'review',
      flag_reason:  null,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recomputeProfileStatus(admin, user.id)

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'green',
    message:      '<strong>New hire</strong> submitted all 4 forms — ready for HR review',
    performed_by: user.id,
  })

  return NextResponse.json({ ok: true })
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
