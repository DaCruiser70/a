'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import '../../../../styles/components/portal-theme.css'
import '../../../../styles/pages/manager.css'
import '../../../../styles/pages/pm.css'
import PortalHeader from '@/components/ui/PortalHeader'
import Modal from '@/components/ui/Modal'
import { formatPlanDate } from '@/components/ui/PlanBadges'
import {
  PM_STATUS_LABELS, PM_DETAIL_FIELDS, PM_DETAIL_LABELS, PM_DETAIL_MAX,
  isPmFieldRequired, type PmDetailField, type PmDetails,
} from '@/lib/pm'
import type { PmRequestStatus } from '@/types'

type Detail = {
  request: {
    hire_id: string; name: string; start_date: string | null; region: string
    manager: string | null; status: PmRequestStatus
    claimed_by_name: string | null; claimed_at: string | null
    completed_by_name: string | null; completed_at: string | null
    mine: boolean
  }
  project: { number: string | null; region: string | null }
  details: PmDetails
  missing: PmDetailField[]
  me: { id: string; name: string }
}

type Action = 'claim' | 'release' | 'done'
type Draft = Record<PmDetailField, string>

const EMPTY_DRAFT: Draft = { dcc: '', standing_offer: '', project_name: '', project_location: '' }
const toDraft = (d: PmDetails): Draft => ({
  dcc:              d.dcc ?? '',
  standing_offer:   d.standing_offer ?? '',
  project_name:     d.project_name ?? '',
  project_location: d.project_location ?? '',
})

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value ? '' : 'empty'}>{value || 'Not provided'}</dd>
    </>
  )
}

// One request in the member's region. Shows the hire's name, region, start date, manager, the
// project number and region from the manager plan, and the project details the team enters here.
export default function PmRequestPage() {
  const params = useParams()
  const hireId = params?.id as string

  const [data, setData]       = useState<Detail | null>(null)
  const [load, setLoad]       = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy]       = useState<Action | null>(null)
  const [error, setError]     = useState('')
  const [notice, setNotice]   = useState('')
  const [confirmDone, setConfirmDone] = useState(false)

  // Project details form (editable only by the claimer, until done)
  const [draft, setDraft]           = useState<Draft>(EMPTY_DRAFT)
  const [fieldErrs, setFieldErrs]   = useState<Partial<Record<PmDetailField, string>>>({})
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState('')
  const [saveNotice, setSaveNotice] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/pm/requests/${hireId}`, { cache: 'no-store' })
      .then(async r => {
        if (cancelled) return
        if (r.status === 404) { setLoad('notfound'); return }
        if (!r.ok) { setLoad('error'); return }
        const d: Detail = await r.json()
        setData(d)
        setDraft(toDraft(d.details))
        setFieldErrs({})
        setLoad('ready')
      })
      .catch(() => { if (!cancelled) setLoad('error') })
    return () => { cancelled = true }
  }, [hireId, attempt])

  async function act(action: Action) {
    setBusy(action)
    setError('')
    setNotice('')
    try {
      const res = await fetch(`/api/pm/requests/${hireId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 404) { setLoad('notfound'); return }
      if (!res.ok) {
        setError(body.error ?? 'Could not save. Please try again.')
        setConfirmDone(false)
        setAttempt(a => a + 1)
        return
      }
      setConfirmDone(false)
      setNotice(action === 'claim' ? 'You claimed this request. You can now fill in the project details.'
        : action === 'release' ? 'Released. It is back in the Open list.'
        : 'Marked as done. HR has been notified.')
      setAttempt(a => a + 1)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  async function saveDetails(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaveError('')
    setSaveNotice('')
    const errs: Partial<Record<PmDetailField, string>> = {}
    for (const f of PM_DETAIL_FIELDS) {
      if (draft[f].trim().length > PM_DETAIL_MAX[f]) errs[f] = `Please keep this under ${PM_DETAIL_MAX[f]} characters.`
    }
    setFieldErrs(errs)
    if (Object.keys(errs).length > 0) return
    setSaving(true)
    try {
      const res = await fetch(`/api/pm/requests/${hireId}/details`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 404) { setLoad('notfound'); return }
      if (!res.ok) {
        if (body.fields) setFieldErrs(body.fields)
        setSaveError(body.error ?? 'Could not save the details. Please try again.')
        if (res.status === 409) setAttempt(a => a + 1)
        return
      }
      setData(d => d ? { ...d, details: body.details, missing: body.missing } : d)
      setDraft(toDraft(body.details))
      setSaveNotice(body.missing?.length ? 'Details saved. You can finish the rest later.' : 'Details saved.')
    } catch {
      setSaveError('Could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const r           = data?.request
  const editable    = !!r && r.status === 'claimed' && r.mine
  const saved       = data ? toDraft(data.details) : EMPTY_DRAFT
  const dirty       = PM_DETAIL_FIELDS.some(f => draft[f].trim() !== saved[f])
  const missing     = data?.missing ?? []
  const doneBlocked = missing.length > 0 || dirty
  const missingText = missing.map(f => PM_DETAIL_LABELS[f]).join(' and ')

  return (
    <div className="mgr-page" data-portal="project_mgmt">
      <PortalHeader portal="project_mgmt" back={{ href: '/project-mgmt/dashboard', label: 'Dashboard' }} />

      <header className="mgr-hero">
        <div className="mgr-hero-orb" />
        <div className="mgr-hero-inner">
          <div className="mgr-hero-tag">Project request</div>
          <h1>{load === 'ready' && r ? r.name : 'Project request'}</h1>
          <p>
            {load === 'ready' && r
              ? [r.region, r.start_date && `Starts ${formatPlanDate(r.start_date)}`].filter(Boolean).join(' · ')
              : 'PSPC & RCMP clearance project details'}
          </p>
        </div>
      </header>

      <main className="mgr-body">
        {load === 'loading' && (
          <div aria-busy="true" aria-label="Loading request">
            <div className="mgr-skeleton block" /><div className="mgr-skeleton block" /><div className="mgr-skeleton block" />
          </div>
        )}

        {load === 'notfound' && (
          <div className="mgr-empty">
            <div className="mgr-empty-icon" aria-hidden="true">🔍</div>
            <div className="mgr-empty-title">We couldn&apos;t find that request</div>
            <div className="mgr-empty-text">It may have been cancelled or belong to another region.</div>
            <div style={{ marginTop: 16 }}><Link href="/project-mgmt/dashboard" className="mgr-more-btn" style={{ display: 'inline-block', margin: 0 }}>← Back to requests</Link></div>
          </div>
        )}

        {load === 'error' && (
          <div className="mgr-error" role="alert">
            The request could not be loaded. Check your connection and try again.
            <button type="button" onClick={() => { setLoad('loading'); setAttempt(a => a + 1) }}>Try again</button>
          </div>
        )}

        {load === 'ready' && data && r && (
          <>
            {notice && <div className="plan-saved" role="status" style={{ marginBottom: '1.25rem' }}>{notice}</div>}

            <section className="pm-panel" aria-labelledby="pm-status-title">
              <div className="pm-panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <h2 id="pm-status-title" className="pm-panel-title">Request</h2>
                  <div className="pm-panel-sub">{r.region} team</div>
                </div>
                <span className={`pm-status ${r.status}`}>{PM_STATUS_LABELS[r.status]}</span>
              </div>
              <div className="pm-panel-body">
                <p className="pm-note" style={{ margin: 0 }}>
                  {r.status === 'open' && 'Nobody has claimed this yet. Claim it to fill in the project details.'}
                  {r.status === 'claimed' && (r.mine
                    ? `You claimed this${r.claimed_at ? ` on ${formatPlanDate(r.claimed_at)}` : ''}.`
                    : `Claimed by ${r.claimed_by_name ?? 'a team member'}${r.claimed_at ? ` on ${formatPlanDate(r.claimed_at)}` : ''}.`)}
                  {r.status === 'done' && `Done${r.completed_by_name ? ` by ${r.completed_by_name}` : ''}${r.completed_at ? ` on ${formatPlanDate(r.completed_at)}` : ''}.`}
                </p>
                {editable && doneBlocked && (
                  <div id="pm-done-blocked" className="pm-missing">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    <span>
                      {missing.length > 0
                        ? <>To mark this done, add <strong>{missingText}</strong> in Project details below and save.</>
                        : 'Save your project details before marking this done.'}
                    </span>
                  </div>
                )}
                {error && <div className="mgr-error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
              </div>
              {(r.status === 'open' || editable) && (
                <div className="pm-actions">
                  {r.status === 'open' && (
                    <button type="button" className="pm-btn primary" disabled={!!busy} onClick={() => act('claim')}>
                      {busy === 'claim' ? 'Claiming…' : 'Claim'}
                    </button>
                  )}
                  {editable && (
                    <>
                      <button type="button" className="pm-btn" disabled={!!busy} onClick={() => act('release')}>
                        {busy === 'release' ? 'Releasing…' : 'Release'}
                      </button>
                      <button
                        type="button" className="pm-btn primary"
                        disabled={!!busy || doneBlocked}
                        aria-describedby={doneBlocked ? 'pm-done-blocked' : undefined}
                        onClick={() => { setError(''); setConfirmDone(true) }}
                      >
                        Mark done
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>

            {/* ── Project details: entered by the member who claimed the request ── */}
            <section className="pm-panel" aria-labelledby="pm-details-title">
              <div className="pm-panel-head">
                <h2 id="pm-details-title" className="pm-panel-title">Project details</h2>
                <div className="pm-panel-sub">
                  {editable ? 'Save as you go. Fields marked (optional) can stay empty.'
                    : r.status === 'done' ? 'Locked: this request is done.'
                    : r.status === 'open' ? 'Claim this request to fill these in.'
                    : 'Only the person who claimed this request can edit these.'}
                </div>
              </div>

              {editable ? (
                <form onSubmit={saveDetails} noValidate>
                  <div className="pm-panel-body pm-fields">
                    {PM_DETAIL_FIELDS.map(f => {
                      const id  = `pm-detail-${f}`
                      const err = fieldErrs[f]
                      const common = {
                        id,
                        value:              draft[f],
                        maxLength:          PM_DETAIL_MAX[f],
                        className:          `pm-input${err ? ' invalid' : ''}`,
                        disabled:           saving,
                        'aria-invalid':     err ? true : undefined,
                        'aria-describedby': [`${id}-count`, err ? `${id}-error` : ''].filter(Boolean).join(' '),
                      }
                      const onChange = (v: string) => {
                        setDraft(d => ({ ...d, [f]: v }))
                        setSaveNotice('')
                        if (err) setFieldErrs(e => { const n = { ...e }; delete n[f]; return n })
                      }
                      return (
                        <div key={f} className={`pm-field${f === 'project_location' ? ' wide' : ''}`}>
                          <label className="pm-label" htmlFor={id}>
                            {f === 'project_location' ? 'Location (full street address)' : PM_DETAIL_LABELS[f]}
                            {isPmFieldRequired(f)
                              ? <span className="pm-required"><span aria-hidden="true"> *</span><span className="pm-sr-only"> (required to mark done)</span></span>
                              : <span className="pm-optional"> (optional)</span>}
                          </label>
                          {f === 'project_location'
                            ? <textarea {...common} rows={2} onChange={e => onChange(e.target.value)} />
                            : <input {...common} onChange={e => onChange(e.target.value)} />}
                          <span id={`${id}-count`} className="pm-count">{draft[f].length}/{PM_DETAIL_MAX[f]} characters</span>
                          {err && <span id={`${id}-error`} className="pm-field-error">{err}</span>}
                        </div>
                      )
                    })}
                    <p className="pm-legend"><span aria-hidden="true">*</span> Required before Mark done.</p>
                    {saveError  && <div className="mgr-error" role="alert">{saveError}</div>}
                    {saveNotice && <div className="plan-saved" role="status" style={{ margin: 0 }}>{saveNotice}</div>}
                  </div>
                  <div className="pm-actions">
                    <button type="button" className="pm-btn" disabled={saving || !dirty} onClick={() => { setDraft(saved); setFieldErrs({}); setSaveError('') }}>
                      Undo changes
                    </button>
                    <button type="submit" className="pm-btn primary" disabled={saving || !dirty}>
                      {saving ? 'Saving…' : 'Save details'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="pm-panel-body">
                  <dl className="pm-rows">
                    {PM_DETAIL_FIELDS.map(f => <Row key={f} label={PM_DETAIL_LABELS[f]} value={data.details[f]} />)}
                  </dl>
                </div>
              )}
            </section>

            <section className="pm-panel" aria-labelledby="pm-hire-title">
              <div className="pm-panel-head"><h2 id="pm-hire-title" className="pm-panel-title">Hire</h2></div>
              <div className="pm-panel-body">
                <dl className="pm-rows">
                  <Row label="Name"       value={r.name} />
                  <Row label="Region"     value={r.region} />
                  <Row label="Start date" value={r.start_date ? formatPlanDate(r.start_date) : null} />
                  <Row label="Manager"    value={r.manager} />
                </dl>
              </div>
            </section>

            <section className="pm-panel" aria-labelledby="pm-project-title">
              <div className="pm-panel-head">
                <h2 id="pm-project-title" className="pm-panel-title">From the manager&apos;s plan</h2>
                <div className="pm-panel-sub">PSPC &amp; RCMP clearance</div>
              </div>
              <div className="pm-panel-body">
                <dl className="pm-rows">
                  <Row label="Project number" value={data.project.number} />
                  <Row label="Project region" value={data.project.region} />
                </dl>
              </div>
            </section>
          </>
        )}
      </main>

      {confirmDone && (
        <Modal
          title="Mark this request done?"
          description="HR will be told the project setup is complete. The project details are locked after this."
          onClose={() => setConfirmDone(false)}
          busy={busy === 'done'}
        >
          {error && <div className="ui-modal-error" role="alert">{error}</div>}
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn-cancel" disabled={busy === 'done'} onClick={() => setConfirmDone(false)}>Cancel</button>
            <button type="button" className="ui-btn-primary" disabled={busy === 'done' || doneBlocked} onClick={() => act('done')}>
              {busy === 'done' ? 'Saving…' : 'Mark done'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
