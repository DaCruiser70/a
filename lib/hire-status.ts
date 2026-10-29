import type { SupabaseClient } from '@supabase/supabase-js'
import type { FormStatus, HireStatus, Database } from '@/types'
import { REQUIRED_DOCUMENT_SLOTS } from './required-documents'

export const HIRE_STATUS_LABELS: Record<HireStatus, string> = {
  'not-started':  'Not Started',
  'in-progress':  'In Progress',
  'needs-review': 'Needs Review',
  'approved':     'Approved',
  'flagged':      'Flagged',
}

// ── The Documents item (one of the 5 onboarding items) ───────────────────────

export type HireDoc = { document_type: string; form_status: string }
export type SlotState = 'approved' | 'review' | 'flagged' | 'missing'

export type DocumentsItem = {
  status:           FormStatus                    // pending = waiting on the hire
  slots:            { key: string; label: string; short: string; state: SlotState }[]
  approvedRequired: number                        // required slots approved
  totalRequired:    number
  missing:          string[]                      // labels of slots the hire still has to upload
  flagged:          string[]                      // labels of slots rejected and waiting on the hire
}

// One slot: approved if any accepted type is approved; otherwise in review if any is awaiting HR;
// otherwise flagged if one was rejected; otherwise missing. So with two IDs uploaded, one approved
// is enough and a rejected extra ID never flags the hire.
function slotState(types: readonly string[], docs: HireDoc[]): SlotState {
  const mine = docs.filter(d => types.includes(d.document_type))
  if (mine.some(d => d.form_status === 'approved')) return 'approved'
  if (mine.some(d => d.form_status === 'review'))   return 'review'
  if (mine.some(d => d.form_status === 'rejected')) return 'flagged'
  return 'missing'
}

export function computeDocumentsItem(docs: HireDoc[]): DocumentsItem {
  const slots = REQUIRED_DOCUMENT_SLOTS.map(s => ({ key: s.key, label: s.label, short: s.short, state: slotState(s.types, docs) }))
  const status: FormStatus =
    slots.every(s => s.state === 'approved') ? 'approved'
    : slots.some(s => s.state === 'flagged') ? 'flagged'
    : slots.some(s => s.state === 'review')  ? 'review'
    : 'pending'
  return {
    status,
    slots,
    approvedRequired: slots.filter(s => s.state === 'approved').length,
    totalRequired:    slots.length,
    missing:          slots.filter(s => s.state === 'missing').map(s => s.label),
    flagged:          slots.filter(s => s.state === 'flagged').map(s => s.label),
  }
}

// ── Hire status: the single source of truth ──────────────────────────────────

export const TOTAL_ITEMS = 5   // the four forms + Documents

export interface HireStatusResult {
  status:        HireStatus
  approvedCount: number          // items approved, of TOTAL_ITEMS
  totalItems:    number
  formsApproved: number          // of the four forms only
  progressPct:   number          // approvedCount / TOTAL_ITEMS
  documents:     DocumentsItem
}

// formStatuses: personal, banking, sin, policy (in that order). docs: the hire's uploaded documents
// (any type; only REQUIRED_DOCUMENT_SLOTS count). Clearance is never part of this.
//   Flagged       anything rejected and waiting on the hire
//   Needs review  anything waiting on HR
//   Approved      all 5 items approved
//   Not started   nothing sent at all
//   In progress   otherwise
export function computeHireStatus(
  formStatuses: (FormStatus | null | undefined)[],
  docs: HireDoc[],
): HireStatusResult {
  const forms     = formStatuses.map(s => s ?? 'pending') as FormStatus[]
  const documents = computeDocumentsItem(docs)
  const items     = [...forms, documents.status]
  const approvedCount = items.filter(s => s === 'approved').length

  let status: HireStatus
  if (items.some(s => s === 'flagged'))
    status = 'flagged'
  else if (items.some(s => s === 'review'))
    status = 'needs-review'
  else if (items.every(s => s === 'approved'))
    status = 'approved'
  else if (items.every(s => s === 'pending'))
    status = 'not-started'
  else
    status = 'in-progress'

  return {
    status,
    approvedCount,
    totalItems:    TOTAL_ITEMS,
    formsApproved: forms.filter(s => s === 'approved').length,
    progressPct:   Math.round(approvedCount / TOTAL_ITEMS * 100),
    documents,
  }
}

// Loads what computeHireStatus needs for one hire. Server only (pass the service client).
export async function loadHireStatusInputs(admin: SupabaseClient<Database>, userId: string) {
  const [pi, bi, si, po, docs] = await Promise.all([
    admin.from('personal_info').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('banking_info').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('sin_info').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('policy_acknowledgements').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('newhire_documents').select('document_type, form_status').eq('user_id', userId),
  ])
  return {
    forms: [pi.data?.form_status, bi.data?.form_status, si.data?.form_status, po.data?.form_status] as (FormStatus | undefined)[],
    docs:  (docs.data ?? []) as HireDoc[],
  }
}

export async function recomputeProfileStatus(
  admin:  SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { forms, docs } = await loadHireStatusInputs(admin, userId)
  const result = computeHireStatus(forms, docs)

  const now = new Date().toISOString()
  await admin.from('profiles').update({
    status:     result.status,
    progress:   result.progressPct,
    updated_at: now,
  }).eq('id', userId)

  // New payroll queueing only on full approval (all 5 items). Never cleared: a hire already queued
  // keeps its payroll record if it later drops out of Approved (lib/payroll-access.ts).
  if (result.status === 'approved') {
    await admin.from('profiles').update({ entered_payroll_queue_at: now })
      .eq('id', userId).is('entered_payroll_queue_at', null)
  }
}
