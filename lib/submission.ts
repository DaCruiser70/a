import { computeHireStatus, computeDocumentsItem, type HireDoc } from './hire-status'
import type { DocumentRequirements } from './required-documents'
import { ONBOARDING_ITEMS } from './form-order'
import type { FormStatus, HireStatus } from '@/types'

// What the hire has sent to HR. Shared by the checklist, the confirmation page and the form routes.
// No server imports.
//
// A form is "sent" as soon as the hire saves it (status review, approved or flagged): there is no
// separate submit step. The required items are the four forms plus Documents (the required
// documents in lib/required-documents.ts), the same five computeHireStatus counts. Security clearance is never part of this.

// The five items, in the shared onboarding order (lib/form-order.ts). Order never affects completion.
export const REQUIRED_ITEMS = ONBOARDING_ITEMS
export type RequiredItem = typeof REQUIRED_ITEMS[number]

// Documents is SENT only when every required slot for this hire has a stored document (any state:
// in review, approved, or rejected and waiting on a new upload). One upload of several is never
// enough. Decided only from the stored documents (lib/required-documents.ts rules, including the
// "Driver's License or Alternative ID" slot and the company-vehicle licence rule).
export function documentsAllUploaded(docs: HireDoc[], req: DocumentRequirements = {}): boolean {
  return computeDocumentsItem(docs, req).missing.length === 0
}

// Documents as one checklist item for the hire. Rejected → flagged (action required). A required
// document still missing → pending (still to do), even when another one is already in review.
// Otherwise the documents item's own state. HR's hire status (computeHireStatus) is unchanged.
export function computeDocumentStatus(docs: HireDoc[], req: DocumentRequirements = {}): FormStatus {
  const item = computeDocumentsItem(docs, req)
  if (item.status === 'flagged') return 'flagged'
  return item.missing.length > 0 ? 'pending' : item.status
}

export type Submission = {
  sent:       number      // required items saved at least once
  total:      number
  complete:   boolean     // every required item has been sent to HR
  hireStatus: HireStatus  // computeHireStatus on all five items, as on the HR dashboard
}

// The four forms count once saved (any status but pending). Documents counts only when every
// required document is uploaded, read from docs (the stored rows), never from a passed-in status.
export function computeSubmission(statuses: Partial<Record<RequiredItem, FormStatus | null | undefined>>, docs: HireDoc[], req: DocumentRequirements = {}): Submission {
  const sent = REQUIRED_ITEMS.filter(item => item === 'documents'
    ? documentsAllUploaded(docs, req)
    : (statuses[item] ?? 'pending') !== 'pending').length
  return {
    sent,
    total:      REQUIRED_ITEMS.length,
    complete:   sent === REQUIRED_ITEMS.length,
    hireStatus: computeHireStatus([statuses.personal, statuses.banking, statuses.sin, statuses.policy], docs, req).status,
  }
}
