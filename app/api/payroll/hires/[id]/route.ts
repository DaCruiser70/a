import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { inPayrollQueue } from '@/lib/payroll-access'
import { decryptFields } from '@/lib/encrypt'

// Only these document types are visible in the payroll portal
const PAYROLL_DOC_TYPES = new Set(['td1_federal', 'td1_provincial', 'direct_deposit'])

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('payroll')
  if (auth instanceof NextResponse) return auth

  const admin = createServiceClient()

  const { id } = await params

  const { data: profile } = await admin
    .from('profiles')
    .select('id, full_name, preferred_name, position, start_date, status, entered_payroll_queue_at, employee_id, payroll_completed_at')
    .eq('id', id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Fully approved hires, plus any hire already in the payroll queue (lib/payroll-access.ts)
  if (!inPayrollQueue(profile)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

  // The banking numbers and the SIN are not decrypted here. They are fetched one hire at a time,
  // on an explicit View click, from POST /api/payroll/hires/[id]/reveal (audited, no-store).

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
        has_numbers:      !!banking.account_number_enc,
      } : null,

      sin: sin ? {
        has_sin:      !!sin.sin_enc,
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
