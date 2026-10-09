import type { SupabaseClient } from '@supabase/supabase-js'
import type { FormStatus, HireStatus, Database } from '@/types'
import { computeHireStatus } from './hire-status'
import { esc } from './safe-html'

const FORM_TABLES: Record<string, string> = {
  personal: 'personal_info',
  banking:  'banking_info',
  sin:      'sin_info',
  policy:   'policy_acknowledgements',
}

type ApplyResult =
  | { ok: false; error: string; httpStatus: number }
  | { ok: true;  overallStatus: HireStatus }

export async function applyFormStatus(
  admin:       SupabaseClient<Database>,
  hireId:      string,
  formId:      string,
  newStatus:   FormStatus,
  reason:      string | undefined,
  performedBy: string,
  actorLabel:  string,
): Promise<ApplyResult> {
  const table = FORM_TABLES[formId]
  if (!table) return { ok: false, error: 'Unknown form', httpStatus: 400 }

  await admin
    .from(table as 'personal_info')
    .update({
      form_status: newStatus,
      flag_reason: newStatus === 'flagged' ? (reason ?? null) : null,
      updated_at:  new Date().toISOString(),
    } as never)
    .eq('user_id', hireId)

  const [pi, bi, si, po] = await Promise.all([
    admin.from('personal_info').select('form_status').eq('user_id', hireId).maybeSingle(),
    admin.from('banking_info').select('form_status').eq('user_id', hireId).maybeSingle(),
    admin.from('sin_info').select('form_status').eq('user_id', hireId).maybeSingle(),
    admin.from('policy_acknowledgements').select('form_status').eq('user_id', hireId).maybeSingle(),
  ])

  const computed = computeHireStatus([
    pi.data?.form_status,
    bi.data?.form_status,
    si.data?.form_status,
    po.data?.form_status,
  ])
  const overallStatus: HireStatus = computed.status

  const now = new Date().toISOString()

  await admin
    .from('profiles')
    .update({ status: overallStatus, progress: computed.progressPct, updated_at: now })
    .eq('id', hireId)

  // Set entered_payroll_queue_at on first transition to approved (idempotent)
  if (overallStatus === 'approved') {
    await admin
      .from('profiles')
      .update({ entered_payroll_queue_at: now })
      .eq('id', hireId)
      .is('entered_payroll_queue_at', null)
  }

  const actionType = newStatus === 'approved' ? 'green' : newStatus === 'flagged' ? 'red' : 'amber'
  const reasonNote = newStatus === 'flagged' && reason ? ` — ${esc(reason)}` : ''
  await admin.from('audit_log').insert({
    user_id:      hireId,
    action_type:  actionType,
    message:      `<strong>${esc(actorLabel)}</strong> marked ${esc(formId)} form as <strong>${esc(newStatus)}</strong>${reasonNote}`,
    performed_by: performedBy,
  })

  return { ok: true, overallStatus }
}
