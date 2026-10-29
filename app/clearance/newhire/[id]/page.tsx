'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import '../../../../styles/components/portal-theme.css'
import '../../../../styles/pages/hr-hire.css'
import '../../../../styles/components/clearance-hr.css'
import '../../../../styles/pages/clearance-portal.css'
import PortalHeader from '@/components/ui/PortalHeader'
import Modal from '@/components/ui/Modal'
import RevealModal, { type RevealedClearance, type RevealResult } from '@/components/hr/hire/RevealModal'
import { formatDob } from '@/lib/personal-info'
import { PackageStepper } from '@/components/hr/ClearanceTrackerCard'
import { formatPlanDate } from '@/components/ui/PlanBadges'
import {
  PACKAGE_STAGE_LABELS, REVIEWER_MOVES, RETURN_NOTE_MAX, formatDcn,
  type PackageStage, type ReviewerAction,
} from '@/lib/clearance'
import { REVEAL_VISIBLE_SECONDS } from '@/lib/reveal'

type Detail = {
  hire: { name: string; role: string | null; office: string | null; region: string | null; start_date: string | null }
  package: {
    stage: PackageStage; sent_at: string | null; stage_updated_at: string | null; stage_by_name: string | null
    returned_note: string | null; done_at: string | null
    history: { id: string; to: PackageStage; at: string; by_name: string | null; note: string | null }[]
  }
  forms: { rcmp: { name: string | null; ext: string | null } | null; fingerprint: { name: string | null; ext: string | null } | null }
  sensitive: { has_legal_name: boolean; has_place_of_birth: boolean; has_dcn: boolean; has_date_of_birth: boolean }
  id_documents: { id: string; label: string; status: string; uploaded_at: string }[]
  project: {
    project_number: string | null; project_region: string | null; project_name: string | null
    dcc: string | null; standing_offer: string | null; project_location: string | null
    manager_name: string | null; project_manager_name: string | null; pm_completed_at: string | null
  }
}

const STAGE_TONE: Record<PackageStage, string> = { needs_review: 'amber', in_process: 'navy solid', done: 'green', returned: 'red' }

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value ? '' : 'cp-empty-value'}>{value || 'Not provided'}</dd>
    </>
  )
}

// One PSPC & RCMP clearance package for the reviewer. She moves it Needs review → In process →
// Done, or sends it back to HR with a note. The server checks every move again.
export default function ClearancePackagePage() {
  const params = useParams()
  const hireId = params?.id as string

  const [data, setData]     = useState<Detail | null>(null)
  const [load, setLoad]     = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy]     = useState<string | null>(null)
  const [error, setError]   = useState('')
  const [notice, setNotice] = useState('')
  const [returning, setReturning] = useState(false)
  const [note, setNote]     = useState('')
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealed, setRevealed]     = useState<RevealedClearance | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/clearance/hires/${hireId}`, { cache: 'no-store' })
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

  // Revealed details hide after 60 seconds and when the page is left
  const shown = !!revealed
  useEffect(() => {
    if (!shown) return
    const t = setTimeout(() => setRevealed(null), REVEAL_VISIBLE_SECONDS * 1000)
    return () => clearTimeout(t)
  }, [shown])
  useEffect(() => {
    const clear = () => setRevealed(null)
    window.addEventListener('pagehide', clear)
    return () => window.removeEventListener('pagehide', clear)
  }, [])

  async function move(action: ReviewerAction) {
    if (!data) return
    setBusy(action)
    setError('')
    setNotice('')
    try {
      const res = await fetch(`/api/clearance/hires/${hireId}/stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expected: data.package.stage, ...(action === 'return' ? { note: note.trim() } : {}) }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 404) { setLoad('notfound'); return }
      if (!res.ok) {
        setError(body.error ?? 'Could not save. Please try again.')
        if (res.status === 409) { setReturning(false); setAttempt(a => a + 1) }
        return
      }
      setReturning(false)
      setNote('')
      setNotice(action === 'start' ? 'Moved to In process.' : action === 'done' ? 'Marked Done. HR has been notified.' : 'Sent back to HR with your note.')
      setAttempt(a => a + 1)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  async function openFile(url: string, key: string, download: boolean) {
    setBusy(key)
    setError('')
    try {
      const res = await fetch(`${url}${download ? '?download=1' : ''}`, { cache: 'no-store' })
      if (!res.ok) { setError('Could not load the file.'); return }
      const { url: signed } = await res.json()
      if (download) window.location.href = signed
      else window.open(signed, '_blank', 'noopener')
    } catch {
      setError('Could not load the file.')
    } finally {
      setBusy(null)
    }
  }

  function onRevealed(result: RevealResult) {
    setRevealOpen(false)
    if (result.group === 'clearance') setRevealed(result.values)
  }

  const p     = data?.package
  const stage = p?.stage
  const next: ReviewerAction | null = stage === 'needs_review' ? 'start' : stage === 'in_process' ? 'done' : null
  const canReturn = stage === 'needs_review' || stage === 'in_process'

  return (
    <div className="cp-page hh" data-portal="clearance">
      <PortalHeader portal="clearance" back={{ href: '/clearance/dashboard', label: 'All packages' }} />

      <header className="cp-hero">
        <div className="cp-container">
          <div className="cp-hero-tag">PSPC &amp; RCMP clearance package</div>
          <h1 className="cp-title">{load === 'ready' && data ? data.hire.name : 'Clearance package'}</h1>
          <p className="cp-sub">
            {load === 'ready' && data
              ? [data.hire.role, data.hire.office, data.hire.region, data.hire.start_date && `Starts ${formatPlanDate(data.hire.start_date)}`].filter(Boolean).join(' · ')
              : 'Forms, ID and project information for review'}
          </p>
        </div>
      </header>

      <main className="cp-container cp-body">
        {load === 'loading' && (
          <div aria-busy="true" aria-label="Loading package">
            <div className="hh-card hh-skeleton-card"><div className="hh-skeleton" /><div className="hh-skeleton" /></div>
            <div className="hh-card hh-skeleton-card"><div className="hh-skeleton" /><div className="hh-skeleton" /></div>
          </div>
        )}

        {load === 'notfound' && (
          <section className="hh-card">
            <div className="hh-empty">
              We couldn’t find that package.
              <div className="cp-gap"><Link href="/clearance/dashboard" className="hh-btn secondary">← All packages</Link></div>
            </div>
          </section>
        )}

        {load === 'error' && (
          <div className="hh-error" role="alert">
            The package could not be loaded. Check your connection and try again.
            <button type="button" className="hh-btn" onClick={() => { setLoad('loading'); setAttempt(a => a + 1) }}>Try again</button>
          </div>
        )}

        {load === 'ready' && data && p && stage && (
          <>
            {notice && <div className="cp-notice" role="status">{notice}</div>}

            {/* ── Stage ── */}
            <section className="hh-card" aria-labelledby="cp-stage-title">
              <div className="hh-card-head row">
                <h2 id="cp-stage-title" className="hh-card-title">Stage</h2>
                <span className={`hh-pill ${STAGE_TONE[stage]}`}>{PACKAGE_STAGE_LABELS[stage]}</span>
              </div>
              <div className="hh-card-body">
                <div className="clr-stepper big"><PackageStepper stage={stage} /></div>
                <p className="clr-pkg-meta">
                  Sent {p.sent_at ? formatPlanDate(p.sent_at) : '—'}
                  {p.stage_updated_at ? ` · Last moved ${formatPlanDate(p.stage_updated_at)}${p.stage_by_name ? ` by ${p.stage_by_name}` : ''}` : ''}
                </p>
                {stage === 'returned' && (
                  <div className="clr-returned">
                    <div className="clr-returned-title">With HR to fix</div>
                    {p.returned_note && <p className="clr-returned-note">{p.returned_note}</p>}
                    <p className="clr-returned-help">It comes back to Needs review when HR resends it.</p>
                  </div>
                )}
                {stage === 'done' && <p className="cp-done">This package is done. HR has been told.</p>}
                {error && <div className="hh-error cp-gap" role="alert">{error}</div>}
              </div>
              {(next || canReturn) && (
                <div className="hh-card-foot">
                  {canReturn && (
                    <button type="button" className="hh-btn danger" disabled={!!busy} onClick={() => { setError(''); setNote(''); setReturning(true) }}>
                      Send back to HR
                    </button>
                  )}
                  {next && (
                    <button type="button" className={`hh-btn${next === 'done' ? ' approve' : ''}`} disabled={!!busy} onClick={() => move(next)}>
                      {busy === next ? 'Saving…' : REVIEWER_MOVES[next].label}
                    </button>
                  )}
                </div>
              )}
            </section>

            <div className="cp-grid">
              {/* ── Forms ── */}
              <section className="hh-card" aria-labelledby="cp-forms-title">
                <div className="hh-card-head"><h2 id="cp-forms-title" className="hh-card-title">Forms</h2></div>
                {([['rcmp', 'RCMP form', data.forms.rcmp], ['fingerprint', 'PSPC fingerprint form', data.forms.fingerprint]] as const).map(([kind, label, f]) => (
                  <div key={kind} className="hh-doc">
                    <div className="hh-doc-text">
                      <div className="hh-doc-name">{label}</div>
                      <div className="hh-doc-meta">{f ? `${f.name ?? `${kind}.${f.ext}`}${f.ext === 'xlsx' ? ' · Excel, download only' : ''}` : 'Not on file'}</div>
                    </div>
                    {f && (
                      <div className="hh-btn-row">
                        {f.ext !== 'xlsx' && (
                          <button type="button" className="hh-btn" disabled={!!busy} onClick={() => openFile(`/api/clearance/hires/${hireId}/file/${kind}`, `${kind}-v`, false)}>View</button>
                        )}
                        <button type="button" className="hh-btn" disabled={!!busy} onClick={() => openFile(`/api/clearance/hires/${hireId}/file/${kind}`, `${kind}-d`, true)}>
                          {busy === `${kind}-d` ? 'Downloading…' : 'Download'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </section>

              {/* ── ID document ── */}
              <section className="hh-card" aria-labelledby="cp-id-title">
                <div className="hh-card-head"><h2 id="cp-id-title" className="hh-card-title">ID document</h2></div>
                {data.id_documents.length === 0 ? <p className="hh-empty">No ID document on file.</p> : data.id_documents.map(d => (
                  <div key={d.id} className="hh-doc">
                    <div className="hh-doc-text">
                      <div className="hh-doc-name">{d.label}</div>
                      <div className="hh-doc-meta">Uploaded {formatPlanDate(d.uploaded_at)}</div>
                    </div>
                    <div className="hh-btn-row">
                      <button type="button" className="hh-btn" disabled={!!busy} onClick={() => openFile(`/api/clearance/hires/${hireId}/id-document/${d.id}`, `id-${d.id}-v`, false)}>View</button>
                      <button type="button" className="hh-btn" disabled={!!busy} onClick={() => openFile(`/api/clearance/hires/${hireId}/id-document/${d.id}`, `id-${d.id}-d`, true)}>
                        {busy === `id-${d.id}-d` ? 'Downloading…' : 'Download'}
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            </div>

            {/* ── Sensitive details (emailed-code reveal) ── */}
            <section className="hh-card" aria-labelledby="cp-sens-title">
              <div className="hh-card-head row">
                <div>
                  <h2 id="cp-sens-title" className="hh-card-title">Clearance details</h2>
                  <p className="hh-card-sub">Encrypted. A code to your email shows them for {REVEAL_VISIBLE_SECONDS} seconds.</p>
                </div>
                {revealed
                  ? <button type="button" className="hh-btn secondary" onClick={() => setRevealed(null)}>Hide</button>
                  : <button type="button" className="hh-btn" onClick={() => setRevealOpen(true)}>Reveal · code sent to your email</button>}
              </div>
              <dl className="hh-fields">
                <dt>Legal name</dt>
                <dd className={`hh-secret${revealed ? ' shown' : ''}`}>
                  {revealed ? (revealed.legal_name ?? 'Not provided') : data.sensitive.has_legal_name ? <><span aria-hidden="true">••••••••</span><span className="hh-sr-only">Hidden</span></> : 'Not provided'}
                </dd>
                <dt>Date of birth</dt>
                <dd className={`hh-secret${revealed ? ' shown' : ''}`}>
                  {revealed ? (formatDob(revealed.date_of_birth) ?? 'Not provided') : data.sensitive.has_date_of_birth ? <><span aria-hidden="true">••••••••</span><span className="hh-sr-only">Hidden</span></> : 'Not provided'}
                </dd>
                <dt>Place of birth</dt>
                <dd className={`hh-secret${revealed ? ' shown' : ''}`}>
                  {revealed ? (revealed.place_of_birth ?? 'Not provided') : data.sensitive.has_place_of_birth ? <><span aria-hidden="true">••••••••</span><span className="hh-sr-only">Hidden</span></> : 'Not provided'}
                </dd>
                <dt>DCN</dt>
                <dd className={`hh-secret${revealed ? ' shown' : ''}`}>
                  {revealed ? (revealed.dcn ? formatDcn(revealed.dcn) : 'Not provided') : data.sensitive.has_dcn ? <><span aria-hidden="true">•••••-•••••-•••••-•••••</span><span className="hh-sr-only">Hidden</span></> : 'Not provided'}
                </dd>
              </dl>
            </section>

            {/* ── Project information ── */}
            <section className="hh-card" aria-labelledby="cp-project-title">
              <div className="hh-card-head"><h2 id="cp-project-title" className="hh-card-title">Project information</h2></div>
              <dl className="hh-fields">
                <Field label="Project number"  value={data.project.project_number} />
                <Field label="Project region"  value={data.project.project_region} />
                <Field label="Project name"    value={data.project.project_name} />
                <Field label="DCC"             value={data.project.dcc} />
                <Field label="Standing Offer"  value={data.project.standing_offer} />
                <Field label="Location"        value={data.project.project_location} />
                <Field label="Manager"         value={data.project.manager_name} />
                <Field label="Project manager" value={data.project.project_manager_name
                  ? `${data.project.project_manager_name}${data.project.pm_completed_at ? ` · done ${formatPlanDate(data.project.pm_completed_at)}` : ''}`
                  : null} />
              </dl>
            </section>

            {p.history.length > 0 && (
              <section className="hh-card" aria-labelledby="cp-history-title">
                <div className="hh-card-head"><h2 id="cp-history-title" className="hh-card-title">History</h2></div>
                <ol className="hh-audit">
                  {p.history.map(h => (
                    <li key={h.id} className="hh-audit-item">
                      <div>
                        <div className="hh-audit-msg"><strong>{PACKAGE_STAGE_LABELS[h.to]}</strong>{h.by_name ? ` · ${h.by_name}` : ''}</div>
                        {h.note && <div className="clr-history-note">{h.note}</div>}
                        <div className="hh-audit-time">{new Date(h.at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </main>

      {returning && (
        <Modal
          title="Send this package back to HR?"
          description="HR sees your note on the hire’s Clearance tab, fixes the problem and resends it."
          onClose={() => setReturning(false)}
          busy={busy === 'return'}
        >
          <label htmlFor="cp-return-note" className="hh-label">Note for HR (required)</label>
          <textarea
            id="cp-return-note"
            className="hh-textarea"
            rows={4}
            maxLength={RETURN_NOTE_MAX}
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <p className="hh-modal-note">{note.length}/{RETURN_NOTE_MAX} characters</p>
          {error && <div className="ui-modal-error" role="alert">{error}</div>}
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn-cancel" disabled={busy === 'return'} onClick={() => setReturning(false)}>Cancel</button>
            <button type="button" className="hh-btn danger" disabled={busy === 'return' || note.trim().length < 5} onClick={() => move('return')}>
              {busy === 'return' ? 'Sending…' : 'Send back to HR'}
            </button>
          </div>
        </Modal>
      )}

      {revealOpen && (
        <RevealModal
          key={hireId}
          hireId={hireId}
          group="clearance"
          endpoint={`/api/clearance/hires/${hireId}/reveal`}
          onClose={() => setRevealOpen(false)}
          onRevealed={onRevealed}
        />
      )}
    </div>
  )
}
