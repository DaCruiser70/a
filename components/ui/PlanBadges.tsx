import '../../styles/components/plan-badges.css'
import { PLAN_STATUS_LABELS, PLAN_CHIP_LABELS, CLEARANCE_LABELS } from '@/lib/manager-plan'
import type { ManagerPlanStatus, PlanChip, ClearanceType } from '@/types'

// Every badge carries its meaning in text; colour and icon only reinforce it.

function formatDate(iso: string): string {
  // Date-only values (YYYY-MM-DD) are shown as calendar dates, not shifted by time zone
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso)
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
}

export { formatDate as formatPlanDate }

export function PlanStatusBadge({
  status, submittedAt, onDark = false,
}: { status: ManagerPlanStatus; submittedAt?: string | null; onDark?: boolean }) {
  const label = status === 'submitted' && submittedAt
    ? `Submitted ${formatDate(submittedAt)}`
    : PLAN_STATUS_LABELS[status]
  return (
    <span className={`plan-badge ${status}${onDark ? ' on-dark' : ''}`}>
      {status === 'submitted' && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
      {label}
    </span>
  )
}

export function OverdueBadge() {
  return (
    <span className="plan-badge overdue">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      Overdue
    </span>
  )
}

export function ClearanceBadge({ type }: { type: ClearanceType }) {
  return <span className={`plan-badge clearance-${type}`}>{CLEARANCE_LABELS[type]}</span>
}

// Quiet companion to a hire's status badge (HR hires tables): same height and pill shape,
// a soft tint and thin border. Lay it out next to the status badge inside .status-badge-row.
export function PlanChipBadge({ chip }: { chip: PlanChip }) {
  return (
    <span className={`plan-chip ${chip}`}>
      <span className="plan-chip-dot" aria-hidden="true" />
      Plan · {PLAN_CHIP_LABELS[chip]}
    </span>
  )
}
