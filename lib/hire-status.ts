import type { SupabaseClient } from '@supabase/supabase-js'
import type { FormStatus, HireStatus, Database } from '@/types'

export interface HireStatusResult {
  status:       HireStatus
  approvedCount: number
  totalForms:   number
  progressPct:  number
}

export function computeHireStatus(
  formStatuses: (FormStatus | null | undefined)[],
): HireStatusResult {
  const statuses = formStatuses.map(s => s ?? 'pending') as FormStatus[]
  const approvedCount = statuses.filter(s => s === 'approved').length
  const totalForms = 4

  let status: HireStatus
  if (statuses.some(s => s === 'flagged'))
    status = 'flagged'
  else if (statuses.every(s => s === 'approved'))
    status = 'approved'
  else if (statuses.every(s => s === 'pending'))
    status = 'not-started'
  else if (statuses.some(s => s === 'review') && statuses.every(s => s !== 'pending'))
    status = 'needs-review'
  else
    status = 'in-progress'

  const progressPct = Math.round(approvedCount / totalForms * 100)
  return { status, approvedCount, totalForms, progressPct }
}

export async function recomputeProfileStatus(
  admin:  SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const [pi, bi, si, po] = await Promise.all([
    admin.from('personal_info').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('banking_info').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('sin_info').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('policy_acknowledgements').select('form_status').eq('user_id', userId).maybeSingle(),
  ])

  const result = computeHireStatus([
    pi.data?.form_status,
    bi.data?.form_status,
    si.data?.form_status,
    po.data?.form_status,
  ])

  const now = new Date().toISOString()
  await admin.from('profiles').update({
    status:     result.status,
    progress:   result.progressPct,
    updated_at: now,
  }).eq('id', userId)

  if (result.status === 'approved') {
    await admin.from('profiles').update({ entered_payroll_queue_at: now })
      .eq('id', userId).is('entered_payroll_queue_at', null)
  }
}
