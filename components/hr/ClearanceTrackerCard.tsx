'use client'

import { useId, useState } from 'react'
import '../../styles/components/clearance-hr.css'
import {
  RCMP_RECIPIENTS, rcmpRecipientForOffice, isRemoteOffice, PACKAGE_STAGE_LABELS, type PackageStage,
} from '@/lib/clearance'
import { formatPlanDate } from '@/components/ui/PlanBadges'
import { projectBlockRows } from '@/lib/pm'
import type { HrClearanceFullView as HrClearanceView } from '@/lib/clearance-package'

type View = Extract<HrClearanceView, { required: true }>

const STAGE_TONE: Record<PackageStage, string> = { needs_review: 'amber', in_process: 'navy solid', done: 'green', returned: 'red' }

function Check({ done, label, detail }: { done: boolean; label: string; detail?: string }) {
  return (
    <li className={`clr-hr-check${done ? ' done' : ''}`}>
      <span className="clr-hr-check-mark" aria-hidden="true">
        {done
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/></svg>}
      </span>
      <span>
        <span className="clr-hr-check-label">{label}</span>
        <span className="clr-hr-check-state">{done ? 'Received' : 'Not yet'}{detail ? ` · ${detail}` : ''}</span>
      </span>
    </li>
  )
}

// Forms approved → Needs review → In process → Done (Returned shown after the step it came back from)
export function PackageStepper({ stage }: { stage: PackageStage | null }) {
  const order: { key: 'forms' | PackageStage; label: string }[] = [
    { key: 'forms', label: 'Forms approved' },
    { key: 'needs_review', label: 'Needs review' },
    { key: 'in_process', label: 'In process' },
    { key: 'done', label: 'Done' },
  ]
  const reached = stage === null ? -1 : stage === 'returned' ? 0 : order.findIndex(s => s.key === stage)
  return (
    <ol className="clr-stepper" aria-label="Clearance package stages">
      {order.map((s, i) => {
        const state = i < reached ? 'done' : i === reached && stage !== 'returned' ? 'current' : i <= reached ? 'done' : 'todo'
        return (
          <li key={s.key} className={`clr-step ${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="clr-step-dot" aria-hidden="true">{state === 'done' ? '✓' : i + 1}</span>
            <span className="clr-step-label">{s.label}</span>
            <span className="hh-sr-only">{state === 'done' ? ' (complete)' : state === 'current' ? ' (current)' : ''}</span>
          </li>
        )
      })}
      {stage === 'returned' && (
        <li className="clr-step returned" aria-current="step">
          <span className="clr-step-dot" aria-hidden="true">!</span>
          <span className="clr-step-label">Returned to HR</span>
        </li>
      )}
    </ol>
  )
}

// HR's clearance tracker. PSPC & RCMP: the package is sent to the clearance reviewer automatically
// when it is complete; HR sees the stage but cannot move it (only "Fix and resend" after a return).
// RCMP only: once the RCMP form is approved, HR ticks "Sent to BGIS". Nothing is emailed from here.
export default function ClearanceTrackerCard({
  hireId, view, onRefresh, onToast,
}: {
  hireId:    string
  view:      View
  onRefresh: () => void
  onToast:   (msg: string) => void
}) {
  const bgisId = useId()
  const [busy, setBusy]       = useState<string | null>(null)
  const [error, setError]     = useState('')
  const [resendWaiting, setResendWaiting] = useState<string[]>([])

  const pkg   = view.package
  const stage = pkg?.stage ?? null
  const remote     = isRemoteOffice(view.office_location)
  const officeKey  = rcmpRecipientForOffice(view.office_location)
  const rcmpTarget = officeKey ? RCMP_RECIPIENTS[officeKey] : null
  const rcmpApproved = view.reviews.rcmp.status === 'approved'
  const waitingList  = resendWaiting.length ? resendWaiting : stage === null ? view.waiting : []

  async function call(key: string, url: string, body: unknown, success: string) {
    setBusy(key)
    setError('')
    setResendWaiting([])
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? 'Could not save. Please try again.')
        if (Array.isArray(data.waiting)) setResendWaiting(data.waiting)
        else if (res.status === 409) onRefresh()
        return
      }
      onToast(success)
      onRefresh()
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  async function copyPspc() {
    setBusy('copy')
    setError('')
    try {
      const res = await fetch(`/api/hr/hires/${hireId}/clearance/tracking`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'copy_pspc_details' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? 'Could not copy.'); return }
      await navigator.clipboard.writeText(data.text as string)
      onToast('PSPC email details copied')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="hrd-card">
      <div className="hrd-card-header">
        <div className="hrd-card-icon navy">
          <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
          </svg>
        </div>
        <div>
          <h2 className="hrd-card-title">Clearance Tracker</h2>
          <div className="hrd-card-sub">
            {view.type === 'pspc_rcmp' ? 'PSPC & RCMP · reviewed by the clearance reviewer' : 'RCMP only · sent to BGIS by HR'}
          </div>
        </div>
      </div>

      <div className="clr-hr-body">
        {/* ── PSPC & RCMP package ── */}
        {pkg && (
          <section className="clr-pkg" aria-labelledby="clr-pkg-title">
            <div className="clr-pkg-head">
              <h3 id="clr-pkg-title" className="clr-hr-section-title">Package</h3>
              {stage
                ? <span className={`hh-pill ${STAGE_TONE[stage]}`}>{PACKAGE_STAGE_LABELS[stage]}</span>
                : <span className="hh-pill grey">Not sent yet</span>}
            </div>
            <PackageStepper stage={stage} />
            {stage && pkg.stage_updated_at && (
              <p className="clr-pkg-meta">
                {stage === 'needs_review' && pkg.sent_at ? `Sent ${formatPlanDate(pkg.sent_at)}` : `Updated ${formatPlanDate(pkg.stage_updated_at)}`}
                {pkg.stage_by_name ? ` by ${pkg.stage_by_name}` : ''}
              </p>
            )}

            {stage === 'returned' && (
              <div className="clr-returned" role="status">
                <div className="clr-returned-title">The clearance reviewer sent this package back to HR</div>
                {pkg.returned_note && <p className="clr-returned-note">{pkg.returned_note}</p>}
                <p className="clr-returned-help">Fix what the note asks for (for example, reject a form so the hire uploads a new one), then resend.</p>
                <button
                  type="button" className="hh-btn" disabled={busy !== null}
                  onClick={() => call('resend', `/api/hr/hires/${hireId}/clearance/package/resend`, {}, 'Package resent to the clearance reviewer')}
                >
                  {busy === 'resend' ? 'Resending…' : 'Fix and resend'}
                </button>
              </div>
            )}

            {waitingList.length > 0 && (
              <div className="clr-waiting">
                <div className="clr-waiting-title">Waiting on:</div>
                <ul>{waitingList.map(w => <li key={w}>{w}</li>)}</ul>
                {stage === null && <p className="clr-pkg-meta">The package goes to the clearance reviewer automatically once everything above is done.</p>}
              </div>
            )}

            {pkg.history.length > 0 && (
              <details className="clr-history">
                <summary>Stage history ({pkg.history.length})</summary>
                <ol>
                  {pkg.history.map(h => (
                    <li key={h.id}>
                      <strong>{PACKAGE_STAGE_LABELS[h.to]}</strong>
                      {' · '}{formatPlanDate(h.at)}{h.by_name ? ` · ${h.by_name}` : ''}
                      {h.note && <div className="clr-history-note">{h.note}</div>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
            <p className="clr-pkg-meta">Only the clearance reviewer can move the stage.</p>
          </section>
        )}

        <div className="clr-hr-section-title">Received</div>
        <ul className="clr-hr-checks">
          <Check done={!!view.legal_name && view.has_place_of_birth} label="Legal name and place of birth" />
          {view.fingerprint && <Check done={view.has_fingerprint} label="PSPC fingerprint form" detail={view.has_dcn ? 'DCN provided' : undefined} />}
          <Check done={view.has_rcmp} label="RCMP form" />
          <Check done={!!view.id} label="ID in Documents" detail={view.id?.label} />
        </ul>

        {view.project && (
          <>
            <div className="clr-hr-section-title">Project</div>
            {!view.pm_done && (
              <div className="clr-hr-waiting" role="status">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span><strong>Waiting on project management.</strong> Details may change until their request is done.</span>
              </div>
            )}
            <dl className="pm-hr-rows">
              {projectBlockRows(view.project).map(row => (
                <div key={row.key} className="pm-hr-row">
                  <dt>{row.label}</dt>
                  <dd className={row.value ? '' : 'empty'}>{row.value ?? 'Not provided'}</dd>
                </div>
              ))}
            </dl>
          </>
        )}

        {/* ── RCMP only: Sent to BGIS ── */}
        {view.bgis && (
          <>
            <div className="clr-hr-section-title">Sends to</div>
            <div className="clr-hr-recipient">
              <div className="clr-hr-recipient-kind">RCMP form{view.office_location ? ` · ${view.office_location} office` : ''}</div>
              {rcmpTarget
                ? <><div className="clr-hr-recipient-name">{rcmpTarget.name}</div><div className="clr-hr-recipient-email">{rcmpTarget.email}</div></>
                : <div className="clr-hr-recipient-email">{remote ? 'Remote hire: use the BGIS contact for their region' : 'No office set for this hire'}</div>}
            </div>
            <label htmlFor={bgisId} className={`clr-bgis${rcmpApproved ? '' : ' disabled'}`}>
              <input
                id={bgisId}
                type="checkbox"
                checked={view.bgis.sent}
                disabled={!rcmpApproved || busy !== null}
                onChange={e => call('bgis', `/api/hr/hires/${hireId}/clearance/bgis`, { sent: e.target.checked }, e.target.checked ? 'Marked as sent to BGIS' : '“Sent to BGIS” cleared')}
              />
              <span>
                <span className="clr-bgis-label">Sent to BGIS</span>
                <span className="clr-bgis-meta">
                  {view.bgis.sent && view.bgis.at
                    ? `${formatPlanDate(view.bgis.at)}${view.bgis.by_name ? ` by ${view.bgis.by_name}` : ''}`
                    : rcmpApproved ? 'Tick once you have sent the approved RCMP form' : 'Approve the RCMP form first'}
                </span>
              </span>
            </label>
          </>
        )}

        {error && <div className="clr-hr-error" role="alert">{error}</div>}
      </div>

      {view.fingerprint && (
        <div className="clr-hr-actions">
          <button type="button" className="clr-hr-btn" disabled={view.status === 'pending' || busy !== null} onClick={copyPspc}>
            {busy === 'copy' ? 'Copying…' : 'Copy PSPC email details'}
          </button>
        </div>
      )}
    </div>
  )
}
