import type { SupabaseClient } from '@supabase/supabase-js'
import type { FormStatus, HireStatus, Database } from '@/types'
import { computeHireStatus, loadHireStatusInputs } from './hire-status'
import { esc } from './safe-html'
import { queueNotification, queueHireApproved } from './notify'
import type { FlagSection } from './notification-templates'

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

  const { forms, docs, req } = await loadHireStatusInputs(admin, hireId)
  const computed = computeHireStatus(forms, docs, req)
  const overallStatus: HireStatus = computed.status

  const now = new Date().toISOString()

  await admin
    .from('profiles')
    .update({ status: overallStatus, progress: computed.progressPct, updated_at: now })
    .eq('id', hireId)

  // Set entered_payroll_queue_at on first transition to approved (idempotent). The call that sets
  // it queues "ready for payroll" and the hire's "you're all set".
  if (overallStatus === 'approved') {
    const { data: queued } = await admin
      .from('profiles')
      .update({ entered_payroll_queue_at: now })
      .eq('id', hireId)
      .is('entered_payroll_queue_at', null)
      .select('id')
    if ((queued?.length ?? 0) > 0) await queueHireApproved(hireId)
  }

  // Sent back: the hire is told which section needs a fix, never the note. One notice per flagged
  // submission (its submitted_at), so a second click or a re-flag of the same submission adds nothing.
  if (newStatus === 'flagged') {
    const { data: row } = await admin.from(table as 'personal_info').select('submitted_at').eq('user_id', hireId).maybeSingle()
    await queueNotification({
      template: 'item_flagged', hireId, payload: { section: formId as FlagSection },
      version:  `${formId}:${row?.submitted_at ?? 'none'}`,
    })
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
