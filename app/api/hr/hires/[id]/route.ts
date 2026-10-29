import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { decryptFields } from '@/lib/encrypt'
import { esc } from '@/lib/safe-html'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { computeHireStatus } from '@/lib/hire-status'
import type { NewHireDetail, FormStatus } from '@/types'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

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
    { data: docs },
  ] = await Promise.all([
    admin.from('profiles').select('*').eq('id', id).single(),
    admin.from('personal_info')
      .select('phone, street, city, province, emergency_name, emergency_phone, form_status, flag_reason, submitted_at, phone_choice, work_phone_platform, date_of_birth, personal_phone')
      .eq('user_id', id).maybeSingle(),
    // Ciphertext columns are read only to know whether a value exists; nothing is decrypted here.
    // The SIN and banking numbers are only ever returned by POST .../reveal/verify.
    admin.from('banking_info')
      .select('bank_name, account_type, void_cheque_path, form_status, flag_reason, submitted_at, account_number_enc')
      .eq('user_id', id).maybeSingle(),
    admin.from('sin_info').select('form_status, sin_enc, flag_reason, submitted_at').eq('user_id', id).maybeSingle(),
    admin.from('policy_acknowledgements').select('*').eq('user_id', id).maybeSingle(),
    admin.from('equipment_provisioning').select('*').eq('user_id', id).maybeSingle(),
    admin.from('hr_notes').select('*').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('audit_log').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(30),
    admin.from('newhire_documents').select('document_type, form_status').eq('user_id', id),
  ])

  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Date of birth and personal phone are never sent on load: only whether they are on file.
  // Their values come only through the 'personal' reveal (POST .../reveal/verify).
  const hasDateOfBirth   = !!personalRaw?.date_of_birth
  const hasPersonalPhone = !!personalRaw?.personal_phone
  const personal = personalRaw
    ? decryptFields({ ...personalRaw, date_of_birth: null, personal_phone: null })
    : null

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

  const computed = computeHireStatus(
    [formStatuses.personal, formStatuses.banking, formStatuses.sin, formStatuses.policy], docs ?? [])

  const flagReasons: Record<string, string | null> = {
    personal: personal?.flag_reason ?? null,
    banking:  banking?.flag_reason  ?? null,
    sin:      sin?.flag_reason      ?? null,
    policy:   policy?.flag_reason   ?? null,
  }

  // "HR record opened": once per page visit. The page fetches this record once; a 30-second
  // window per HR user and hire absorbs React's development double-run and fast reloads.
  const opened = await rateLimit(await rateLimitKey('hr:record-opened', `${user.id}:${id}`), 1, 30)
  if (opened.allowed) {
    const { data: caller } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    await admin.from('audit_log').insert({
      user_id:      id,
      action_type:  'navy',
      message:      `<strong>${esc(caller?.full_name ?? 'HR')}</strong> opened the HR record for <strong>${esc(profile.full_name)}</strong>`,
      performed_by: user.id,
    })
  }

  const detail: NewHireDetail & { policy_signature?: string } = {
    id:                      profile.id,
    name:                    profile.full_name,
    email:                   profile.aem_email,
    role:                    profile.position ?? '—',
    status:                  computed.status,
    progress:                computed.progressPct,
    approved_items:          computed.approvedCount,
    total_items:             computed.totalItems,
    submitted:               submittedDate,
    days,
    office_location:         profile.office_location          ?? null,
    region:                  profile.region                   ?? null,
    phone:                   personal?.phone                  ?? '—',
    start_date:              profile.start_date               ?? '—',
    address:                 personal
      ? [personal.street, [personal.city, personal.province].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'
      : '—',
    emergency_contact:       personal?.emergency_name         ?? '—',
    emergency_phone:         personal?.emergency_phone        ?? '—',
    bank_name:               banking?.bank_name               ?? '—',
    account_type:            banking?.account_type            ?? '—',
    has_banking:             !!banking?.account_number_enc,
    has_sin:                 !!sin?.sin_enc,
    has_date_of_birth:       hasDateOfBirth,
    has_personal_phone:      hasPersonalPhone,
    phone_choice:            personal?.phone_choice           ?? null,
    work_phone_platform:     personal?.work_phone_platform    ?? null,
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
