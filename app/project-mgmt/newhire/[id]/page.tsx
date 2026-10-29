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
import { PM_STATUS_LABELS } from '@/lib/pm'
import type { PmRequestStatus } from '@/types'

type Detail = {
  request: {
    hire_id: string; name: string; start_date: string | null; region: string
    branch: string | null; manager: string | null; status: PmRequestStatus
    claimed_by_name: string | null; claimed_at: string | null
    completed_by_name: string | null; completed_at: string | null
    mine: boolean
  }
  project: { number: string | null; name: string | null; region: string | null; location: string | null; branch: string | null }
  me: { id: string; name: string }
}

type Action = 'claim' | 'release' | 'done'

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value ? '' : 'empty'}>{value || 'Not provided'}</dd>
    </>
  )
}

// One request in the member's region. Shows the hire's name, region, branch, start date, manager
// and the project block from the manager plan — nothing else about the hire.
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

  useEffect(() => {
    let cancelled = false
    fetch(`/api/pm/requests/${hireId}`, { cache: 'no-store' })
      .then(async r => {
        if (cancelled) return
        if (r.status === 404) { setLoad('notfound'); return }
        if (!r.ok) { setLoad('error'); return }
        setData(await r.json())
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
      if (!res.ok) { setError(body.error ?? 'Could not save. Please try again.'); setAttempt(a => a + 1); return }
      setConfirmDone(false)
      setNotice(action === 'claim' ? 'You claimed this request.' : action === 'release' ? 'Released. It is back in the Open list.' : 'Marked as done. HR has been notified.')
      setAttempt(a => a + 1)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const r = data?.request

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
              ? [r.region, r.branch, r.start_date && `Starts ${formatPlanDate(r.start_date)}`].filter(Boolean).join(' · ')
              : 'PSPC & RCMP clearance project details'}
          </p>
        </div>
      </header>

      <main className="mgr-body">
        {load === 'loading' && (
          <div aria-busy="true" aria-label="Loading request">
            <div className="mgr-skeleton block" /><div className="mgr-skeleton block" />
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
                  {r.status === 'open' && 'Nobody has claimed this yet.'}
                  {r.status === 'claimed' && (r.mine
                    ? `You claimed this${r.claimed_at ? ` on ${formatPlanDate(r.claimed_at)}` : ''}.`
                    : `Claimed by ${r.claimed_by_name ?? 'a team member'}${r.claimed_at ? ` on ${formatPlanDate(r.claimed_at)}` : ''}.`)}
                  {r.status === 'done' && `Done${r.completed_by_name ? ` by ${r.completed_by_name}` : ''}${r.completed_at ? ` on ${formatPlanDate(r.completed_at)}` : ''}.`}
                </p>
                {error && <div className="mgr-error" role="alert" style={{ marginTop: 12 }}>{error}</div>}
              </div>
              {(r.status === 'open' || (r.status === 'claimed' && r.mine)) && (
                <div className="pm-actions">
                  {r.status === 'open' && (
                    <button type="button" className="pm-btn primary" disabled={!!busy} onClick={() => act('claim')}>
                      {busy === 'claim' ? 'Claiming…' : 'Claim'}
                    </button>
                  )}
                  {r.status === 'claimed' && r.mine && (
                    <>
                      <button type="button" className="pm-btn" disabled={!!busy} onClick={() => act('release')}>
                        {busy === 'release' ? 'Releasing…' : 'Release'}
                      </button>
                      <button type="button" className="pm-btn primary" disabled={!!busy} onClick={() => { setError(''); setConfirmDone(true) }}>
                        Mark done
                      </button>
                    </>
                  )}
                </div>
              )}
            </section>

            <section className="pm-panel" aria-labelledby="pm-hire-title">
              <div className="pm-panel-head"><h2 id="pm-hire-title" className="pm-panel-title">Hire</h2></div>
              <div className="pm-panel-body">
                <dl className="pm-rows">
                  <Row label="Name"       value={r.name} />
                  <Row label="Region"     value={r.region} />
                  <Row label="Branch"     value={r.branch} />
                  <Row label="Start date" value={r.start_date ? formatPlanDate(r.start_date) : null} />
                  <Row label="Manager"    value={r.manager} />
                </dl>
              </div>
            </section>

            <section className="pm-panel" aria-labelledby="pm-project-title">
              <div className="pm-panel-head">
                <h2 id="pm-project-title" className="pm-panel-title">Project</h2>
                <div className="pm-panel-sub">From the manager&apos;s onboarding plan</div>
              </div>
              <div className="pm-panel-body">
                <dl className="pm-rows">
                  <Row label="Project number" value={data.project.number} />
                  <Row label="Project name"   value={data.project.name} />
                  <Row label="Project region" value={data.project.region} />
                  <Row label="Location"       value={data.project.location} />
                  <Row label="Branch"         value={data.project.branch} />
                </dl>
              </div>
            </section>
          </>
        )}
      </main>

      {confirmDone && (
        <Modal
          title="Mark this request done?"
          description="HR will be told the project setup is complete. This can't be undone from the portal."
          onClose={() => setConfirmDone(false)}
          busy={busy === 'done'}
        >
          {error && <div className="ui-modal-error" role="alert">{error}</div>}
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn-cancel" disabled={busy === 'done'} onClick={() => setConfirmDone(false)}>Cancel</button>
            <button type="button" className="ui-btn-primary" disabled={busy === 'done'} onClick={() => act('done')}>
              {busy === 'done' ? 'Saving…' : 'Mark done'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
