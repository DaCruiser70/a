import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      form_status: 'review',
      flag_reason: null,
    }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // All 4 forms submitted → 100% progress, needs-review
  await admin
    .from('profiles')
    .update({ progress: 100, status: 'needs-review', updated_at: new Date().toISOString() })
    .eq('id', user.id)

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'green',
    message:      '<strong>New hire</strong> submitted all 4 forms — ready for HR review',
    performed_by: user.id,
  })

  return NextResponse.json({ ok: true })
}

export async function GET() {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
