import Link from 'next/link'
import '../../styles/components/plan-badges.css'
import { PLAN_STATUS_LABELS, PLAN_CHIP_LABELS, CLEARANCE_LABELS } from '@/lib/manager-plan'
import { CLEARANCE_STATUS_LABELS } from '@/lib/clearance'
import { PM_CHIP_LABELS } from '@/lib/pm'
import type { ManagerPlanStatus, PlanChip, ClearanceType, ClearanceStatus, PmChip } from '@/types'

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

// Clearance chip: the same quiet pill as the plan chip, reusing its colour meaning
// (not submitted → grey, needs review → amber, approved → green, flagged → red)
const CLEARANCE_CHIP_TONE: Record<ClearanceStatus, PlanChip> = {
  pending: 'awaiting', review: 'draft', approved: 'submitted', flagged: 'overdue',
}

// With href (HR dashboard), the chip links to the hire's Clearance tab
export function ClearanceChipBadge({ status, href }: { status: ClearanceStatus; href?: string }) {
  if (href) {
    return (
      <Link href={href} className={`plan-chip ${CLEARANCE_CHIP_TONE[status]} action`} onClick={e => e.stopPropagation()}>
        <span className="plan-chip-dot" aria-hidden="true" />
        Clearance · {CLEARANCE_STATUS_LABELS[status]}
      </Link>
    )
  }
  return (
    <span className={`plan-chip ${CLEARANCE_CHIP_TONE[status]}`}>
      <span className="plan-chip-dot" aria-hidden="true" />
      Clearance · {CLEARANCE_STATUS_LABELS[status]}
    </span>
  )
}

// Project management chip: open → amber (waiting), claimed → copper (the project portal's colour),
// done → green, needs region → red (HR must set the hire's region)
const PM_CHIP_TONE: Record<PmChip, string> = {
  open: 'draft', claimed: 'pm', done: 'submitted', needs_region: 'overdue',
}

// With setRegionHref, "Set region" becomes a link that opens the hire's Region editor; with href,
// every other state links to the hire's Plan & Project tab (HR dashboard)
export function PmChipBadge({ state, claimedByName, setRegionHref, href }: { state: PmChip; claimedByName?: string | null; setRegionHref?: string; href?: string }) {
  const label = state === 'claimed' && claimedByName ? `Claimed by ${claimedByName}` : PM_CHIP_LABELS[state]
  if (state === 'needs_region' && setRegionHref) {
    return (
      <Link href={setRegionHref} className={`plan-chip ${PM_CHIP_TONE[state]} action`} onClick={e => e.stopPropagation()}>
        <span className="plan-chip-dot" aria-hidden="true" />
        Project mgmt · {label}
        <span aria-hidden="true">→</span>
      </Link>
    )
  }
  if (href) {
    return (
      <Link href={href} className={`plan-chip ${PM_CHIP_TONE[state]} action`} onClick={e => e.stopPropagation()}>
        <span className="plan-chip-dot" aria-hidden="true" />
        Project mgmt · {label}
      </Link>
    )
  }
  return (
    <span className={`plan-chip ${PM_CHIP_TONE[state]}`}>
      <span className="plan-chip-dot" aria-hidden="true" />
      Project mgmt · {label}
    </span>
  )
}
