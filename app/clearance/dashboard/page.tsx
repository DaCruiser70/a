'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import '../../../styles/components/portal-theme.css'
import '../../../styles/pages/hr-hire.css'
import '../../../styles/pages/clearance-portal.css'
import PortalHeader from '@/components/ui/PortalHeader'
import { formatPlanDate } from '@/components/ui/PlanBadges'
import { useMe } from '@/lib/use-me'
import { PACKAGE_STAGES, PACKAGE_STAGE_LABELS, type PackageStage } from '@/lib/clearance'

type Row = {
  hire_id: string; name: string; role: string | null; office: string | null; region: string | null
  project_name: string | null; sent_at: string | null; stage: PackageStage
}
type TabState = { rows: Row[]; hasMore: boolean; next: number; status: 'loading' | 'ready' | 'error'; more: boolean }

const PAGE = 25
const INITIAL: TabState = { rows: [], hasMore: false, next: 0, status: 'loading', more: false }
const EMPTY: Record<PackageStage, string> = {
  needs_review: 'Nothing waiting for review. New packages appear here when HR’s checks are complete.',
  in_process:   'Nothing in process. Packages you start reviewing move here.',
  done:         'No finished packages yet.',
  returned:     'Nothing is with HR right now.',
}

// The clearance reviewer's list: PSPC & RCMP packages that have been sent, one tab per stage.
export default function ClearanceDashboard() {
  const { me } = useMe()
  const [tab, setTab]       = useState<PackageStage>('needs_review')
  const [state, setState]   = useState<Record<PackageStage, TabState>>({ needs_review: INITIAL, in_process: INITIAL, done: INITIAL, returned: INITIAL })
  const [counts, setCounts] = useState<Record<PackageStage, number> | null>(null)
  const tabRefs = useRef<Partial<Record<PackageStage, HTMLButtonElement | null>>>({})

  const load = useCallback(async (stage: PackageStage, offset: number) => {
    setState(s => ({ ...s, [stage]: offset === 0 ? { ...INITIAL } : { ...s[stage], more: true } }))
    try {
      const res = await fetch(`/api/clearance/packages?stage=${stage}&offset=${offset}&limit=${PAGE}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const d = await res.json() as { rows: Row[]; counts: Record<PackageStage, number>; hasMore: boolean; nextOffset: number }
      setCounts(d.counts)
      setState(s => ({ ...s, [stage]: { rows: offset === 0 ? d.rows : [...s[stage].rows, ...d.rows], hasMore: d.hasMore, next: d.nextOffset, status: 'ready', more: false } }))
    } catch {
      setState(s => ({ ...s, [stage]: offset === 0 ? { ...s[stage], status: 'error' } : { ...s[stage], more: false } }))
    }
  }, [])

  useEffect(() => { load(tab, 0) }, [tab, load])

  function onTabKey(e: React.KeyboardEvent) {
    const i = PACKAGE_STAGES.indexOf(tab)
    const next = e.key === 'ArrowRight' ? PACKAGE_STAGES[(i + 1) % PACKAGE_STAGES.length]
               : e.key === 'ArrowLeft'  ? PACKAGE_STAGES[(i - 1 + PACKAGE_STAGES.length) % PACKAGE_STAGES.length]
               : e.key === 'Home' ? PACKAGE_STAGES[0] : e.key === 'End' ? PACKAGE_STAGES[PACKAGE_STAGES.length - 1] : null
    if (!next) return
    e.preventDefault()
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  const cur = state[tab]
  const firstName = me?.name?.split(' ')[0]

  return (
    <div className="cp-page hh" data-portal="clearance">
      <PortalHeader portal="clearance" />

      <header className="cp-hero">
        <div className="cp-container">
          <div className="cp-hero-tag">Clearance review</div>
          <h1 className="cp-title">{firstName ? `Welcome, ${firstName}` : 'Clearance packages'}</h1>
          <p className="cp-sub">PSPC &amp; RCMP clearance packages sent by HR. Open one to review it and move it along.</p>
        </div>
      </header>

      <main className="cp-container cp-body">
        <div className="cp-tabs" role="tablist" aria-label="Package stages" onKeyDown={onTabKey}>
          {PACKAGE_STAGES.map(s => (
            <button
              key={s}
              ref={el => { tabRefs.current[s] = el }}
              type="button" role="tab" id={`cp-tab-${s}`} aria-controls="cp-panel"
              aria-selected={s === tab} tabIndex={s === tab ? 0 : -1}
              className={`hh-chip${s === tab ? ' active' : ''}`}
              onClick={() => setTab(s)}
            >
              {PACKAGE_STAGE_LABELS[s]}
              <span className="cp-count">{counts ? counts[s] : '–'}</span>
            </button>
          ))}
        </div>

        <section id="cp-panel" role="tabpanel" aria-labelledby={`cp-tab-${tab}`} className="hh-card">
          {cur.status === 'loading' && (
            <div className="hh-card-body" aria-busy="true" aria-label="Loading packages">
              <div className="hh-skeleton" /><div className="hh-skeleton" /><div className="hh-skeleton" />
            </div>
          )}
          {cur.status === 'error' && (
            <div className="hh-card-body">
              <div className="hh-error" role="alert">
                The packages could not be loaded.
                <button type="button" className="hh-btn" onClick={() => load(tab, 0)}>Try again</button>
              </div>
            </div>
          )}
          {cur.status === 'ready' && cur.rows.length === 0 && <p className="hh-empty">{EMPTY[tab]}</p>}
          {cur.status === 'ready' && cur.rows.length > 0 && (
            <div className="cp-table-wrap">
              <table className="cp-table">
                <caption className="hh-sr-only">{PACKAGE_STAGE_LABELS[tab]} packages</caption>
                <thead>
                  <tr>
                    <th scope="col">New hire</th>
                    <th scope="col">Office / region</th>
                    <th scope="col">Project</th>
                    <th scope="col">Sent</th>
                    <th scope="col"><span className="hh-sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {cur.rows.map(r => (
                    <tr key={r.hire_id}>
                      <td>
                        <div className="cp-name">{r.name}</div>
                        <div className="cp-sub-cell">{r.role ?? '—'}</div>
                      </td>
                      <td>
                        <div>{r.office ?? '—'}</div>
                        <div className="cp-sub-cell">{r.region ?? 'No region'}</div>
                      </td>
                      <td>{r.project_name ?? <span className="cp-sub-cell">Not provided</span>}</td>
                      <td className="cp-nowrap">{r.sent_at ? formatPlanDate(r.sent_at) : '—'}</td>
                      <td className="cp-action">
                        <Link href={`/clearance/newhire/${r.hire_id}`} className="hh-btn" aria-label={`Open ${r.name}`}>Open</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cur.status === 'ready' && cur.hasMore && (
            <div className="hh-card-foot">
              <button type="button" className="hh-btn secondary" disabled={cur.more} onClick={() => load(tab, cur.next)}>
                {cur.more ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
