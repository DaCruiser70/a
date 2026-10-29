// Which hires payroll may see and work on. No server imports.
//
// A hire enters the payroll queue the first time all 5 onboarding items are approved
// (entered_payroll_queue_at is set then, never cleared). Payroll keeps a hire it already has, even if
// the hire later drops out of Approved (for example when the Documents item became one of the 5
// required items): nothing payroll has is removed. A hire never queued before appears only once
// fully approved.
export function inPayrollQueue(p: { status: string | null; entered_payroll_queue_at: string | null } | null | undefined): boolean {
  return !!p && (p.status === 'approved' || !!p.entered_payroll_queue_at)
}

// PostgREST filter for the same rule (payroll list)
export const PAYROLL_QUEUE_FILTER = 'status.eq.approved,entered_payroll_queue_at.not.is.null'
