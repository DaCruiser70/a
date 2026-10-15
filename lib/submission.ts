import { computeHireStatus } from './hire-status'
import type { FormStatus, HireStatus } from '@/types'

// What the hire has sent to HR. Shared by the checklist, the confirmation page and the form routes.
// No server imports.
//
// A form is "sent" as soon as the hire saves it (status review, approved or flagged): there is no
// separate submit step. The required items are the four forms computeHireStatus reads plus the
// required tax documents. Security clearance is never part of this.

export const REQUIRED_ITEMS = ['personal', 'banking', 'sin', 'policy', 'documents'] as const
export type RequiredItem = typeof REQUIRED_ITEMS[number]

// Tax forms every hire must upload (document_type values from the documents page)
export const REQUIRED_DOC_TYPES = ['td1_federal', 'td1_provincial'] as const

// Documents as one checklist item (moved from the checklist page so the server uses the same rule)
export function computeDocumentStatus(docs: Array<{ document_type: string; form_status: string }>): FormStatus {
  const requiredDocs = REQUIRED_DOC_TYPES.map(t => docs.find(d => d.document_type === t))
  if (docs.some(d => d.form_status === 'rejected')) return 'flagged'
  if (requiredDocs.every(d => d?.form_status === 'approved')) return 'approved'
  if (requiredDocs.every(d => !!d)) return 'review'
  return 'pending'
}

export type Submission = {
  sent:       number      // required items saved at least once
  total:      number
  complete:   boolean     // every required item has been sent to HR
  hireStatus: HireStatus  // computeHireStatus on the four forms, as on the HR dashboard
}

export function computeSubmission(statuses: Partial<Record<RequiredItem, FormStatus | null | undefined>>): Submission {
  const sent = REQUIRED_ITEMS.filter(item => (statuses[item] ?? 'pending') !== 'pending').length
  return {
    sent,
    total:      REQUIRED_ITEMS.length,
    complete:   sent === REQUIRED_ITEMS.length,
    hireStatus: computeHireStatus([statuses.personal, statuses.banking, statuses.sin, statuses.policy]).status,
  }
}
