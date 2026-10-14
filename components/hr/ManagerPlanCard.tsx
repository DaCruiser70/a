'use client'

import { useEffect, useId, useRef, useState } from 'react'
import '../../styles/components/manager-plan-card.css'
import Modal from '@/components/ui/Modal'
import ManagerSelect from '@/components/ui/ManagerSelect'
import { PlanStatusBadge, OverdueBadge, ClearanceBadge, formatPlanDate } from '@/components/ui/PlanBadges'
import { PortalTag } from '@/components/ui/PortalName'
import { TRAINING_DELIVERY_LABELS, type PlanAnswers } from '@/lib/manager-plan'
import type { ManagerPlanStatus } from '@/types'

type PlanView = {
  status:       ManagerPlanStatus
  due_date:     string | null
  submitted_at: string | null
  overdue:      boolean
  answers:      PlanAnswers | null
}
type Data = { manager: { id: string; name: string } | null; plan: PlanView | null }

// Plain-text answer, clamped to ~6 lines with Show more / Show less when it actually overflows
function ClampText({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const textId = useId()
  const [expanded, setExpanded]       = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Measured only while clamped; width changes (e.g. rotating a phone) re-measure
    const ro = new ResizeObserver(() => {
      if (el.classList.contains('clamped')) setOverflowing(el.scrollHeight > el.clientHeight + 1)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])

  return (
    <>
      <div id={textId} ref={ref} className={`mpc-value${expanded ? '' : ' clamped'}`}>{text}</div>
      {(overflowing || expanded) && (
        <button
          type="button"
          className="mpc-more"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  )
}

function Row({ label, text, children }: { label: string; text?: string | null; children?: React.ReactNode }) {
  const empty = children === undefined && !text
  return (
    <div className="mpc-row">
      <div className="mpc-label">{label}</div>
      <div className="mpc-cell">
        {children ?? (empty ? <div className="mpc-value empty">Not answered</div> : <ClampText text={text!} />)}
      </div>
    </div>
  )
}

// "Manager Plan" card for the HR detail page. Collapsed by default: header, status, one summary row.
// Once the plan is submitted, "View plan" expands every answer. Change manager is always in the header.
export default function ManagerPlanCard({
  hireId, onManagerChanged,
}: {
  hireId: string
  onManagerChanged?: (manager: { name: string; email: string }) => void
}) {
  const [data, setData]       = useState<Data | null>(null)
  const [status, setStatus]   = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)   // per card, not remembered
  const regionId = useId()

  const [modalOpen, setModalOpen] = useState(false)
  const [choice, setChoice]       = useState('')
  const [missing, setMissing]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [modalError, setModalError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/hr/hires/${hireId}/manager-plan`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: Data) => { if (!cancelled) { setData(d); setStatus('ready') } })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [hireId, attempt])

  function openModal() {
    setChoice('')
    setMissing(false)
    setModalError('')
    setModalOpen(true)
  }

  async function submitReassign(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!choice) { setMissing(true); return }
    setSaving(true)
    setModalError('')
    try {
      const res = await fetch(`/api/hr/hires/${hireId}/manager-plan/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ managerId: choice }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setModalError(body.error ?? 'Could not change the manager. Please try again.'); return }
      setModalOpen(false)
      if (body.manager && !body.unchanged) onManagerChanged?.({ name: body.manager.name, email: body.manager.email })
      setExpanded(false)
      setStatus('loading')
      setAttempt(a => a + 1)
    } catch {
      setModalError('Could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const plan        = data?.plan ?? null
  const manager     = data?.manager ?? null
  const managerName = manager?.name ?? 'the manager'
  const a           = plan?.status === 'submitted' ? plan.answers : null
  const showProject = !!a && [a.project_number, a.project_name, a.project_region, a.project_location, a.project_branch].some(Boolean)

  return (
    <div className="hrd-card">
      <div className="hrd-card-header mpc-header">
        <div className="hrd-card-icon navy">
          <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
            <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
          </svg>
        </div>
        <div className="mpc-title-block">
          <div className="hrd-card-title mpc-title">
            Manager Plan
            <PortalTag role="manager">Manager</PortalTag>
          </div>
          <div className="hrd-card-sub">Training and first-weeks plan from the reporting manager</div>
        </div>

        {status === 'ready' && (
          <div className="mpc-header-right">
            {plan && (
              <div className="mpc-badges">
                <PlanStatusBadge status={plan.status} submittedAt={plan.submitted_at} />
                {plan.overdue && <OverdueBadge />}
              </div>
            )}
            <div className="mpc-actions">
              <button type="button" className="mpc-action" onClick={openModal}>
                {plan ? 'Change manager' : 'Choose manager'}
              </button>
              {a && (
                <button
                  type="button"
                  className="mpc-action mpc-toggle"
                  aria-expanded={expanded}
                  aria-controls={regionId}
                  onClick={() => setExpanded(v => !v)}
                >
                  {expanded ? 'Hide plan' : 'View plan'}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {status === 'loading' && (
        <div className="mpc-summary" aria-busy="true" aria-label="Loading manager plan">
          <div className="mpc-skeleton" style={{ width: '55%' }} />
        </div>
      )}

      {status === 'error' && (
        <div className="mpc-summary">
          <div className="mpc-error" role="alert">
            The manager plan could not be loaded.
            <button type="button" onClick={() => { setStatus('loading'); setAttempt(n => n + 1) }}>Try again</button>
          </div>
        </div>
      )}

      {/* ── Collapsed summary: one row ── */}
      {status === 'ready' && (
        <div className="mpc-summary">
          {!plan ? (
            <span className="mpc-summary-text muted">
              No manager plan has been requested for this hire.
              {manager ? ` Their reporting manager is ${manager.name}.` : ''}
            </span>
          ) : a ? (
            <>
              <span className="mpc-summary-text">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" className="done">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>
                  Submitted by <strong>{managerName}</strong>
                  {plan.submitted_at && <> on {formatPlanDate(plan.submitted_at)}</>}
                </span>
              </span>
              <ClearanceBadge type={a.clearance_type} />
            </>
          ) : (
            <span className="mpc-summary-text">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="waiting">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <span>Awaiting <strong>{managerName}</strong></span>
            </span>
          )}
        </div>
      )}

      {/* ── Answers (submitted plans only): animated open / closed ── */}
      {status === 'ready' && a && (
        <div className={`mpc-collapse${expanded ? ' open' : ''}`}>
          <div id={regionId} className="mpc-collapse-inner" role="region" aria-label="Manager plan answers" inert={!expanded}>
            <div className="mpc-body">
              <div className="mpc-group">Training</div>
              <Row label="Training needed" text={a.training_needed} />
              <Row label="How they will get it" text={a.training_delivery.map(d => TRAINING_DELIVERY_LABELS[d]).join(', ')} />
              <Row label="Training notes" text={a.training_notes} />

              <div className="mpc-group">First three weeks</div>
              <Row label="Week 1" text={a.week1} />
              <Row label="Week 2" text={a.week2} />
              <Row label="Week 3" text={a.week3} />

              <div className="mpc-group">Day one</div>
              <Row label="Who will meet them" text={a.day_one_contact} />
              <Row label="Day-one gear" text={a.first_day_gear} />

              <div className="mpc-group">Clearance</div>
              <Row label="Clearance type"><ClearanceBadge type={a.clearance_type} /></Row>
              {showProject && (
                <>
                  {a.clearance_type !== 'pspc_rcmp' && (
                    <div className="mpc-note">Project details below were entered under an earlier PSPC &amp; RCMP answer and have been kept.</div>
                  )}
                  <Row label="Project number" text={a.project_number} />
                  <Row label="Project name"   text={a.project_name} />
                  <Row label="Project region" text={a.project_region} />
                  <Row label="Location"       text={a.project_location} />
                  <Row label="Branch"         text={a.project_branch} />
                </>
              )}

              <div className="mpc-group">Anything else</div>
              <Row label="Notes for HR" text={a.anything_else} />
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <Modal
          title={plan ? 'Change manager' : 'Choose a manager'}
          description={plan
            ? 'The plan moves to the new manager with every answer kept. They will be asked to complete it.'
            : 'The manager will be asked to complete an onboarding plan for this hire.'}
          onClose={() => setModalOpen(false)}
          busy={saving}
        >
          <form onSubmit={submitReassign} noValidate>
            <ManagerSelect
              value={choice}
              invalid={missing}
              label="New manager"
              onChange={id => { setChoice(id); if (id) setMissing(false) }}
            />
            {modalError && <div className="ui-modal-error" role="alert">{modalError}</div>}
            <div className="ui-modal-actions">
              <button type="button" className="ui-btn-cancel" disabled={saving} onClick={() => setModalOpen(false)}>Cancel</button>
              <button type="submit" className="ui-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : plan ? 'Change manager' : 'Request plan'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
