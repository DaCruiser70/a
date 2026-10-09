import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { decrypt, decryptFields } from '@/lib/encrypt'

// Only these document types are visible in the payroll portal
const PAYROLL_DOC_TYPES = new Set(['td1_federal', 'td1_provincial', 'direct_deposit'])

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'payroll') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, preferred_name, position, start_date, status, entered_payroll_queue_at, employee_id, payroll_completed_at')
    .eq('id', id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Payroll only processes approved hires
  if (profile.status !== 'approved') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [
    { data: personalRaw },
    { data: banking },
    { data: sin },
    { data: policy },
    { data: allDocs },
  ] = await Promise.all([
    admin.from('personal_info').select('*').eq('user_id', id).maybeSingle(),
    admin.from('banking_info').select('*').eq('user_id', id).maybeSingle(),
    admin.from('sin_info').select('form_status, flag_reason, sin_enc, submitted_at').eq('user_id', id).maybeSingle(),
    admin.from('policy_acknowledgements').select('form_status, signature, agreed_at, submitted_at').eq('user_id', id).maybeSingle(),
    admin.from('newhire_documents')
      .select('id, document_type, document_label, file_name, form_status, flag_reason, uploaded_at')
      .eq('user_id', id)
      .order('uploaded_at', { ascending: true }),
  ])

  const personal = personalRaw ? decryptFields(personalRaw) : null

  // Decrypt banking fields server-side — never logged or returned raw
  let bankingDecrypted: Record<string, string> = {}
  if (banking) {
    try {
      bankingDecrypted = {
        institution_number: decrypt(banking.institution_number_enc),
        transit_number:     decrypt(banking.transit_number_enc),
        account_number:     decrypt(banking.account_number_enc),
      }
    } catch { /* decryption failed */ }
  }

  let sinDecrypted: string | undefined
  if (sin?.sin_enc) {
    try { sinDecrypted = decrypt(sin.sin_enc) } catch { /* decryption failed */ }
  }

  // Filter documents to only payroll-relevant types
  const documents = (allDocs ?? []).filter(d => PAYROLL_DOC_TYPES.has(d.document_type))

  return NextResponse.json({
    detail: {
      id:                       profile.id,
      full_name:                profile.full_name,
      preferred_name:           profile.preferred_name ?? null,
      position:                 profile.position ?? null,
      start_date:               profile.start_date ?? null,
      status:                   profile.status,
      entered_payroll_queue_at: profile.entered_payroll_queue_at ?? null,
      employee_id:              profile.employee_id ?? null,
      payroll_completed_at:     profile.payroll_completed_at ?? null,

      personal: personal ? {
        first_name:             personal.first_name,
        last_name:              personal.last_name,
        date_of_birth:          personal.date_of_birth,
        phone:                  personal.phone,
        personal_email:         personal.personal_email,
        street:                 personal.street,
        city:                   personal.city,
        province:               personal.province,
        postal_code:            personal.postal_code,
        emergency_name:         personal.emergency_name,
        emergency_relationship: personal.emergency_relationship,
        emergency_phone:        personal.emergency_phone,
        form_status:            personal.form_status,
        flag_reason:            personal.flag_reason ?? null,
        submitted_at:           personal.submitted_at ?? null,
      } : null,

      banking: banking ? {
        bank_name:        banking.bank_name,
        account_type:     banking.account_type,
        has_void_cheque:  !!(banking.void_cheque_path),
        form_status:      banking.form_status,
        flag_reason:      banking.flag_reason ?? null,
        submitted_at:     banking.submitted_at ?? null,
        ...bankingDecrypted,
      } : null,

      sin: sin ? {
        sin:          sinDecrypted ?? null,
        form_status:  sin.form_status,
        flag_reason:  sin.flag_reason ?? null,
        submitted_at: sin.submitted_at ?? null,
      } : null,

      policy_signed:    !!policy,
      policy_signed_at: policy?.agreed_at ?? null,

      documents,
    },
  })
}
