'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import '../../../styles/components/portal-theme.css'
import '../../../styles/pages/manager.css'
import '../../../styles/pages/pm.css'
import { useMe } from '@/lib/use-me'
import PortalHeader from '@/components/ui/PortalHeader'
import { formatPlanDate } from '@/components/ui/PlanBadges'
import { PM_STATUS_LABELS, PM_TABS, type PmTab } from '@/lib/pm'
import type { PmRequestStatus } from '@/types'

type PmCard = {
  hire_id:         string
  name:            string
  start_date:      string | null
  region:          string
  project_number:  string | null
  manager:         string | null
  status:          PmRequestStatus
  claimed_by_name: string | null
  completed_at:    string | null
}

type TabState = { items: PmCard[]; total: number; hasMore: boolean; status: 'loading' | 'ready' | 'error'; loadingMore: boolean }

const PAGE_SIZE = 25
const INITIAL: TabState = { items: [], total: 0, hasMore: false, status: 'loading', loadingMore: false }

const TAB_LABELS: Record<PmTab, string> = { open: 'Open', mine: 'Mine', done: 'Done' }
const EMPTY: Record<PmTab, { title: string; text: string }> = {
  open: { title: 'Nothing open', text: 'New requests appear here when a manager submits a plan that needs a PSPC & RCMP clearance.' },
  mine: { title: 'Nothing claimed by you', text: 'Claim a request from the Open tab and it will appear here until you mark it done.' },
  done: { title: 'Nothing done yet', text: 'Requests you or your team mark as done are listed here.' },
}

function RequestCard({ item }: { item: PmCard }) {
  return (
    <article className="mgr-card" aria-label={item.name}>
      <div className="mgr-card-body">
        <div className="mgr-card-top">
          <div style={{ minWidth: 0 }}>
            <div className="mgr-card-name">{item.name}</div>
            <div className="mgr-card-role">{item.project_number ? `Project ${item.project_number}` : 'Project number not set'}</div>
          </div>
          <span className={`pm-status ${item.status}`}>{PM_STATUS_LABELS[item.status]}</span>
        </div>
        <dl className="pm-card-rows">
          <dt>Start</dt><dd>{item.start_date ? formatPlanDate(item.start_date) : '—'}</dd>
          <dt>Manager</dt><dd>{item.manager ?? '—'}</dd>
          {item.status === 'claimed' && <><dt>Claimed by</dt><dd>{item.claimed_by_name ?? '—'}</dd></>}
          {item.status === 'done' && item.completed_at && <><dt>Done</dt><dd>{formatPlanDate(item.completed_at)}</dd></>}
        </dl>
      </div>
      <div className="mgr-card-foot">
        <Link href={`/project-mgmt/newhire/${item.hire_id}`} className={`mgr-open-btn${item.status === 'done' ? ' quiet' : ''}`}>
          {item.status === 'open' ? 'Open request →' : 'View request →'}
        </Link>
      </div>
    </article>
  )
}

export default function PmDashboard() {
  const { me } = useMe()
  const name = me?.name ?? ''
  const [tab, setTab]       = useState<PmTab>('open')
  const [region, setRegion] = useState<string | null>(null)
  const [tabs, setTabs]     = useState<Record<PmTab, TabState>>({ open: INITIAL, mine: INITIAL, done: INITIAL })
  const tabRefs = useRef<Record<PmTab, HTMLButtonElement | null>>({ open: null, mine: null, done: null })

  const load = useCallback(async (which: PmTab, offset: number) => {
    setTabs(t => ({ ...t, [which]: offset === 0 ? { ...INITIAL } : { ...t[which], loadingMore: true } }))
    try {
      const res = await fetch(`/api/pm/requests?tab=${which}&limit=${PAGE_SIZE}&offset=${offset}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const data = await res.json() as { region: string; requests: PmCard[]; total: number; hasMore: boolean }
      setRegion(data.region)
      setTabs(t => ({
        ...t,
        [which]: {
          items:       offset === 0 ? data.requests : [...t[which].items, ...data.requests],
          total:       data.total,
          hasMore:     data.hasMore,
          status:      'ready',
          loadingMore: false,
        },
      }))
    } catch {
      setTabs(t => ({ ...t, [which]: offset === 0 ? { ...t[which], status: 'error' } : { ...t[which], loadingMore: false } }))
    }
  }, [])

  useEffect(() => {
    // Counts for every tab up front; each tab keeps its own list
    PM_TABS.forEach(t => load(t, 0))
  }, [load])

  function onTabKey(e: React.KeyboardEvent) {
    const i = PM_TABS.indexOf(tab)
    const next = e.key === 'ArrowRight' ? PM_TABS[(i + 1) % PM_TABS.length]
               : e.key === 'ArrowLeft'  ? PM_TABS[(i - 1 + PM_TABS.length) % PM_TABS.length]
               : e.key === 'Home' ? PM_TABS[0] : e.key === 'End' ? PM_TABS[PM_TABS.length - 1] : null
    if (!next) return
    e.preventDefault()
    setTab(next)
    tabRefs.current[next]?.focus()
  }

  const current   = tabs[tab]
  const openCount = tabs.open.status === 'ready' ? tabs.open.total : null

  return (
    <div className="mgr-page" data-portal="project_mgmt">
      <PortalHeader portal="project_mgmt" />

      <header className="mgr-hero">
        <div className="mgr-hero-orb" />
        <div className="mgr-hero-inner">
          <div className="mgr-hero-tag">
            <span className="mgr-hero-dot" style={{ background: openCount ? '#F59E0B' : '#34D399' }} aria-hidden="true" />
            {region ? `${region} team` : 'Regional team'}
          </div>
          <h1>{name ? `Welcome back, ${name.split(' ')[0]}.` : 'Project requests'}</h1>
          <p>
            {openCount === null ? 'Loading requests…'
              : openCount === 0 ? 'No open requests right now.'
              : `${openCount} open request${openCount !== 1 ? 's' : ''} waiting for someone to claim`}
          </p>
        </div>
      </header>

      <main className="mgr-body">
        <div className="pm-tabs" role="tablist" aria-label="Requests" onKeyDown={onTabKey}>
          {PM_TABS.map(t => (
            <button
              key={t}
              ref={el => { tabRefs.current[t] = el }}
              type="button"
              role="tab"
              id={`pm-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`pm-panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              className="pm-tab"
              onClick={() => setTab(t)}
            >
              {TAB_LABELS[t]}
              {tabs[t].status === 'ready' && <span className="pm-tab-count">{tabs[t].total}</span>}
            </button>
          ))}
        </div>

        <section id={`pm-panel-${tab}`} role="tabpanel" aria-labelledby={`pm-tab-${tab}`}>
          {current.status === 'loading' ? (
            <div className="mgr-grid" aria-busy="true" aria-label="Loading requests">
              <div className="mgr-skeleton card" /><div className="mgr-skeleton card" />
            </div>
          ) : current.status === 'error' ? (
            <div className="mgr-error" role="alert">
              We couldn&apos;t load these requests. Check your connection and try again.
              <button type="button" onClick={() => load(tab, 0)}>Try again</button>
            </div>
          ) : current.items.length === 0 ? (
            <div className="mgr-empty">
              <div className="mgr-empty-icon" aria-hidden="true">📋</div>
              <div className="mgr-empty-title">{EMPTY[tab].title}</div>
              <div className="mgr-empty-text">{EMPTY[tab].text}</div>
            </div>
          ) : (
            <>
              <div className="mgr-grid">
                {current.items.map(item => <RequestCard key={item.hire_id} item={item} />)}
              </div>
              {current.hasMore && (
                <button type="button" className="mgr-more-btn" onClick={() => load(tab, current.items.length)} disabled={current.loadingMore}>
                  {current.loadingMore ? 'Loading…' : `Show more (${current.total - current.items.length} remaining)`}
                </button>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
