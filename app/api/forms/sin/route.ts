import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { encrypt, decrypt } from '@/lib/encrypt'
import { recomputeProfileStatus } from '@/lib/hire-status'

export async function POST(request: Request) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { sin } = await request.json()
  const sinDigits = sin.replace(/\s/g, '')
  if (sinDigits.length !== 9) {
    return NextResponse.json({ error: 'SIN must be 9 digits.' }, { status: 400 })
  }

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recomputeProfileStatus(admin, user.id)

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'navy',
    message:      '<strong>New hire</strong> submitted Social Insurance Number',
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
