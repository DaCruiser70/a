import { computeHireStatus, computeDocumentsItem, type HireDoc } from './hire-status'
import type { FormStatus, HireStatus } from '@/types'

// What the hire has sent to HR. Shared by the checklist, the confirmation page and the form routes.
// No server imports.
//
// A form is "sent" as soon as the hire saves it (status review, approved or flagged): there is no
// separate submit step. The required items are the four forms plus Documents (the required
// documents in lib/required-documents.ts), the same five computeHireStatus counts. Security clearance is never part of this.

export const REQUIRED_ITEMS = ['personal', 'banking', 'sin', 'policy', 'documents'] as const
export type RequiredItem = typeof REQUIRED_ITEMS[number]

// Documents as one checklist item: the same rule computeHireStatus uses (lib/required-documents.ts)
export function computeDocumentStatus(docs: HireDoc[]): FormStatus {
  return computeDocumentsItem(docs).status
}

export type Submission = {
  sent:       number      // required items saved at least once
  total:      number
  complete:   boolean     // every required item has been sent to HR
  hireStatus: HireStatus  // computeHireStatus on all five items, as on the HR dashboard
}

export function computeSubmission(statuses: Partial<Record<RequiredItem, FormStatus | null | undefined>>, docs: HireDoc[]): Submission {
  const sent = REQUIRED_ITEMS.filter(item => (statuses[item] ?? 'pending') !== 'pending').length
  return {
    sent,
    total:      REQUIRED_ITEMS.length,
    complete:   sent === REQUIRED_ITEMS.length,
    hireStatus: computeHireStatus([statuses.personal, statuses.banking, statuses.sin, statuses.policy], docs).status,
  }
}
