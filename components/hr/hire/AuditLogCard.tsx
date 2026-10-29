'use client'

import { useEffect, useState } from 'react'
import { SafeMessage } from '@/lib/safe-html'
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_LABELS, categorizeAudit, type AuditCategory } from '@/lib/audit-categories'
import type { AuditEntry } from '@/types'

type Entry = Pick<AuditEntry, 'id' | 'action_type' | 'message' | 'created_at'>
type State = { entries: Entry[]; hasMore: boolean; next: number; status: 'loading' | 'ready' | 'error'; more: boolean }

const PAGE = 25
const INITIAL: State = { entries: [], hasMore: false, next: 0, status: 'loading', more: false }

// Notes & Activity tab: the audit log, newest first, 25 at a time, with category chips.
// Messages are escaped when written and rendered through SafeMessage, as before.
// localEntries: entries this page added without a reload (shown on top, like the old card).
export default function AuditLogCard({ hireId, refreshKey, localEntries }: {
  hireId: string
  refreshKey: number
  localEntries: Entry[]
}) {
  const [category, setCategory] = useState<AuditCategory>('all')
  const [state, setState]       = useState<State>(INITIAL)
  const [attempt, setAttempt]   = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/hr/hires/${hireId}/audit?offset=0&limit=${PAGE}&category=${category}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (!cancelled) setState({ entries: d.entries, hasMore: d.hasMore, next: d.nextOffset, status: 'ready', more: false }) })
      .catch(() => { if (!cancelled) setState(s => ({ ...s, status: 'error' })) })
    return () => { cancelled = true }
  }, [hireId, category, refreshKey, attempt])

  async function loadMore() {
    setState(s => ({ ...s, more: true }))
    try {
      const r = await fetch(`/api/hr/hires/${hireId}/audit?offset=${state.next}&limit=${PAGE}&category=${category}`, { cache: 'no-store' })
      if (!r.ok) throw new Error()
      const d = await r.json()
      setState(s => ({ entries: [...s.entries, ...d.entries], hasMore: d.hasMore, next: d.nextOffset, status: 'ready', more: false }))
    } catch {
      setState(s => ({ ...s, more: false, status: 'error' }))
    }
  }

  function choose(c: AuditCategory) {
    if (c === category) return
    setState(INITIAL)
    setCategory(c)
  }

  const local = localEntries.filter(e => category === 'all' || categorizeAudit(e.message) === category)
  const shown = [...local, ...state.entries]

  return (
    <section className="hh-card" aria-labelledby="hh-audit-title">
      <div className="hh-card-head">
        <h2 id="hh-audit-title" className="hh-card-title">Audit log</h2>
        <p className="hh-card-sub">Record of all actions taken</p>
      </div>

      <div className="hh-chips" role="group" aria-label="Filter activity">
        {AUDIT_CATEGORIES.map(c => (
          <button key={c} type="button" className={`hh-chip${c === category ? ' active' : ''}`} aria-pressed={c === category} onClick={() => choose(c)}>
            {AUDIT_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {state.status === 'loading' && (
        <div className="hh-card-body" aria-busy="true" aria-label="Loading activity">
          <div className="hh-skeleton" /><div className="hh-skeleton" /><div className="hh-skeleton" style={{ width: '60%' }} />
        </div>
      )}

      {state.status === 'error' && (
        <div className="hh-card-body">
          <div className="hh-error" role="alert">
            The activity could not be loaded.
            <button type="button" className="hh-btn" onClick={() => { setState(INITIAL); setAttempt(a => a + 1) }}>Try again</button>
          </div>
        </div>
      )}

      {state.status === 'ready' && shown.length === 0 && (
        <div className="hh-empty">
          {category === 'all' ? 'No activity recorded yet.' : `No ${AUDIT_CATEGORY_LABELS[category].toLowerCase()} activity yet.`}
        </div>
      )}

      {state.status === 'ready' && shown.length > 0 && (
        <>
          <ol className="hh-audit" aria-live="polite">
            {shown.map(entry => (
              <li key={entry.id} className="hh-audit-item">
                <span className={`hh-dot ${entry.action_type === 'green' ? 'green' : entry.action_type === 'red' ? 'red' : entry.action_type === 'amber' ? 'amber' : 'navy'}`} aria-hidden="true" />
                <div>
                  <div className="hh-audit-msg"><SafeMessage message={entry.message} /></div>
                  <div className="hh-audit-time">{new Date(entry.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                </div>
              </li>
            ))}
          </ol>
          {state.hasMore && (
            <div className="hh-card-foot">
              <button type="button" className="hh-btn secondary" disabled={state.more} onClick={loadMore}>
                {state.more ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
