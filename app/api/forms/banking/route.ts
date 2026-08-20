import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/encrypt'

export async function POST(request: Request) {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { bankName, accountType, institutionNumber, transitNumber, accountNumber, voidChequePath } = body

  const admin = createServiceClient()

  // Preserve existing void_cheque_path if no new one was uploaded
  let finalVoidChequePath: string | null = voidChequePath ?? null
  if (!voidChequePath) {
    const { data: existing } = await admin
      .from('banking_info')
      .select('void_cheque_path')
      .eq('user_id', user.id)
      .maybeSingle()
    finalVoidChequePath = existing?.void_cheque_path ?? null
  }

  const { error } = await admin
    .from('banking_info')
    .upsert({
      user_id:                user.id,
      bank_name:              bankName,
      account_type:           accountType,
      institution_number_enc: encrypt(institutionNumber),
      transit_number_enc:     encrypt(transitNumber),
      account_number_enc:     encrypt(accountNumber),
      void_cheque_path:       finalVoidChequePath,
      form_status:            'review',
      flag_reason:            null,
    }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin
    .from('profiles')
    .update({ progress: 50, status: 'in-progress', updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .lt('progress', 50)

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'navy',
    message:      '<strong>New hire</strong> submitted banking &amp; direct deposit',
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
    .from('banking_info')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return NextResponse.json({ existing: null })

  let institutionNumber = '', transitNumber = '', accountNumber = ''
  try {
    institutionNumber = decrypt(data.institution_number_enc)
    transitNumber     = decrypt(data.transit_number_enc)
    accountNumber     = decrypt(data.account_number_enc)
  } catch { /* key mismatch or corrupted data */ }

  return NextResponse.json({
    existing: {
      bankName:          data.bank_name,
      accountType:       data.account_type,
      institutionNumber,
      transitNumber,
      accountNumber,
      formStatus:        data.form_status,
      flagReason:        data.flag_reason ?? null,
      voidChequePath:    data.void_cheque_path ?? null,
    },
  })
}
