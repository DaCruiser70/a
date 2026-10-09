import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { decrypt, decryptFields } from '@/lib/encrypt'
import { computeHireStatus } from '@/lib/hire-status'
import type { NewHireDetail, FormStatus } from '@/types'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const admin = createServiceClient()

  const { id } = await params

  // Fetch all data in parallel
  const [
    { data: profile },
    { data: personalRaw },
    { data: banking },
    { data: sin },
    { data: policy },
    { data: equipment },
    { data: notes },
    { data: auditLog },
  ] = await Promise.all([
    admin.from('profiles').select('*').eq('id', id).single(),
    admin.from('personal_info')
      .select('phone, street, city, province, emergency_name, emergency_phone, form_status, flag_reason, submitted_at')
      .eq('user_id', id).maybeSingle(),
    admin.from('banking_info').select('*').eq('user_id', id).maybeSingle(),
    admin.from('sin_info').select('form_status, sin_enc, flag_reason, submitted_at').eq('user_id', id).maybeSingle(),
    admin.from('policy_acknowledgements').select('*').eq('user_id', id).maybeSingle(),
    admin.from('equipment_provisioning').select('*').eq('user_id', id).maybeSingle(),
    admin.from('hr_notes').select('*').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('audit_log').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(30),
  ])

  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const personal = personalRaw ? decryptFields(personalRaw) : null

  const submittedDate = profile.start_date ?? profile.created_at.slice(0, 10)
  const days = Math.max(0, Math.floor((Date.now() - new Date(submittedDate).getTime()) / 86_400_000))

  const formSubmittedAt: Record<string, string | null> = {
    personal: personal?.submitted_at ?? null,
    banking:  banking?.submitted_at  ?? null,
    sin:      sin?.submitted_at      ?? null,
    policy:   policy?.submitted_at   ?? null,
  }
  const submittedTimestamps = Object.values(formSubmittedAt).filter((t): t is string => !!t)
  const last_submitted_at = submittedTimestamps.length > 0
    ? submittedTimestamps.reduce((a, b) => (a > b ? a : b))
    : null

  const formStatuses: Record<string, FormStatus> = {
    personal: (personal?.form_status ?? 'pending') as FormStatus,
    banking:  (banking?.form_status  ?? 'pending') as FormStatus,
    sin:      (sin?.form_status      ?? 'pending') as FormStatus,
    policy:   (policy?.form_status   ?? 'pending') as FormStatus,
  }

  const computed = computeHireStatus(Object.values(formStatuses))

  const flagReasons: Record<string, string | null> = {
    personal: personal?.flag_reason ?? null,
    banking:  banking?.flag_reason  ?? null,
    sin:      sin?.flag_reason      ?? null,
    policy:   policy?.flag_reason   ?? null,
  }

  // Decrypt banking details for HR (audit-logged by the client when viewed)
  let bankDetails: Record<string, string> = {}
  if (banking) {
    try {
      bankDetails = {
        institution_number: decrypt(banking.institution_number_enc),
        transit_number:     decrypt(banking.transit_number_enc),
        account_number:     decrypt(banking.account_number_enc),
      }
    } catch { /* decryption failed — bad key or corrupted data */ }
  }

  let sinDecrypted: string | undefined
  if (sin?.sin_enc) {
    try { sinDecrypted = decrypt(sin.sin_enc) } catch { /* bad key or corrupted */ }
  }

  const detail: NewHireDetail & { bank_details?: Record<string, string>; sin?: string; policy_signature?: string } = {
    id:                      profile.id,
    name:                    profile.full_name,
    email:                   profile.aem_email,
    role:                    profile.position ?? '—',
    status:                  computed.status,
    progress:                computed.progressPct,
    submitted:               submittedDate,
    days,
    office_location:         profile.office_location          ?? null,
    phone:                   personal?.phone                  ?? '—',
    start_date:              profile.start_date               ?? '—',
    address:                 personal
      ? [personal.street, [personal.city, personal.province].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'
      : '—',
    emergency_contact:       personal?.emergency_name         ?? '—',
    emergency_phone:         personal?.emergency_phone        ?? '—',
    bank_name:               banking?.bank_name               ?? '—',
    account_type:            banking?.account_type            ?? '—',
    bank_details:            bankDetails,
    sin:                     sinDecrypted,
    policy_signature:        policy?.signature,
    form_statuses:           formStatuses,
    flag_reasons:            flagReasons,
    form_submitted_at:       formSubmittedAt,
    last_submitted_at,
    has_void_cheque:         !!(banking?.void_cheque_path),
    equipment_items:         (equipment?.items as Record<string, boolean>) ?? {},
    notes:                   notes                            ?? [],
    audit_log:               auditLog                         ?? [],
    preferred_name:          profile.preferred_name           ?? null,
    personal_email:          profile.personal_email           ?? null,
    reporting_manager_name:  profile.reporting_manager_name   ?? null,
    reporting_manager_email: profile.reporting_manager_email  ?? null,
    form_deadline:           profile.form_deadline            ?? null,
    probation_period:        profile.probation_period         ?? null,
    probation_end_date:      profile.probation_end_date       ?? null,
    probation_status:        profile.probation_status         ?? null,
    employee_id:             profile.employee_id              ?? null,
    payroll_completed_at:    profile.payroll_completed_at     ?? null,
  }

  return NextResponse.json({ detail })
}
