'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import '../../../styles/components/portal-theme.css'
import '../../../styles/pages/manager.css'
import { useMe } from '@/lib/use-me'
import PortalHeader from '@/components/ui/PortalHeader'
import { PlanStatusBadge, OverdueBadge, formatPlanDate } from '@/components/ui/PlanBadges'
import { HIRE_STATUS_LABELS } from '@/lib/hire-status'
import type { HireStatus, ManagerPlanStatus } from '@/types'

type ManagerHire = {
  hire_id:         string
  name:            string
  position:        string | null
  start_date:      string | null
  office_location: string | null
  progress:        number
  hire_status:     HireStatus
  plan_status:     ManagerPlanStatus
  due_date:        string | null
  submitted_at:    string | null
  overdue:         boolean
}

type Section = 'action' | 'submitted'
type SectionState = { hires: ManagerHire[]; total: number; hasMore: boolean; status: 'loading' | 'ready' | 'error'; loadingMore: boolean }

const PAGE_SIZE = 25
const INITIAL: SectionState = { hires: [], total: 0, hasMore: false, status: 'loading', loadingMore: false }

function HireCard({ hire }: { hire: ManagerHire }) {
  const needsAction = hire.plan_status !== 'submitted'
  return (
    <article className={`mgr-card${hire.overdue ? ' overdue' : needsAction ? ' needs-action' : ''}`} aria-label={hire.name}>
      <div className="mgr-card-body">
        <div className="mgr-card-top">
          <div style={{ minWidth: 0 }}>
            <div className="mgr-card-name">{hire.name}</div>
            {hire.position && <div className="mgr-card-role">{hire.position}</div>}
            <div className="mgr-card-meta">
              {hire.start_date && <span>Start: {formatPlanDate(hire.start_date)}</span>}
              {hire.office_location && <span>{hire.office_location}</span>}
            </div>
          </div>
          <div className="mgr-card-badges">
            <PlanStatusBadge status={hire.plan_status} submittedAt={hire.submitted_at} />
            {hire.overdue && <OverdueBadge />}
          </div>
        </div>

        <div className="mgr-progress" aria-label={`Onboarding items ${hire.progress}% approved`}>
          <div className="mgr-progress-bar" aria-hidden="true">
            <div className="mgr-progress-fill" style={{ width: `${hire.progress}%` }} />
          </div>
          <div className="mgr-progress-pct">{hire.progress}%</div>
        </div>
        <div className="mgr-progress-label">Onboarding forms · {HIRE_STATUS_LABELS[hire.hire_status]}</div>

        {needsAction && (
          <div className="mgr-due">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            {hire.due_date ? <>Plan due {formatPlanDate(hire.due_date)}</> : 'No due date set'}
          </div>
        )}
      </div>
      <div className="mgr-card-foot">
        <Link href={`/manager/newhire/${hire.hire_id}`} className={`mgr-open-btn${needsAction ? '' : ' quiet'}`}>
          {needsAction ? 'Open plan →' : 'View or update →'}
        </Link>
      </div>
    </article>
  )
}

function SectionBlock({
  title, state, emptyTitle, emptyText, onRetry, onMore,
}: {
  title: string; state: SectionState; emptyTitle: string; emptyText: string
  onRetry: () => void; onMore: () => void
}) {
  const headingId = `section-${title.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <section className="mgr-section" aria-labelledby={headingId}>
      <h2 id={headingId} className="mgr-section-title">
        {title}
        {state.status === 'ready' && <span className="mgr-section-count">{state.total}</span>}
      </h2>

      {state.status === 'loading' ? (
        <div className="mgr-grid" aria-busy="true" aria-label={`Loading ${title}`}>
          <div className="mgr-skeleton card" /><div className="mgr-skeleton card" />
        </div>
      ) : state.status === 'error' ? (
        <div className="mgr-error" role="alert">
          We couldn&apos;t load this list. Check your connection and try again.
          <button type="button" onClick={onRetry}>Try again</button>
        </div>
      ) : state.hires.length === 0 ? (
        <div className="mgr-empty">
          <div className="mgr-empty-icon" aria-hidden="true">📋</div>
          <div className="mgr-empty-title">{emptyTitle}</div>
          <div className="mgr-empty-text">{emptyText}</div>
        </div>
      ) : (
        <>
          <div className="mgr-grid">
            {state.hires.map(h => <HireCard key={h.hire_id} hire={h} />)}
          </div>
          {state.hasMore && (
            <button type="button" className="mgr-more-btn" onClick={onMore} disabled={state.loadingMore}>
              {state.loadingMore ? 'Loading…' : `Show more (${state.total - state.hires.length} remaining)`}
            </button>
          )}
        </>
      )}
    </section>
  )
}

export default function ManagerDashboard() {
  const { me } = useMe()
  const displayName = me?.name ?? ''
  const [action, setAction]       = useState<SectionState>(INITIAL)
  const [submitted, setSubmitted] = useState<SectionState>(INITIAL)

  const load = useCallback(async (section: Section, offset: number) => {
    const set = section === 'action' ? setAction : setSubmitted
    set(s => offset === 0 ? { ...INITIAL } : { ...s, loadingMore: true })
    try {
      const res = await fetch(`/api/manager/hires?section=${section}&limit=${PAGE_SIZE}&offset=${offset}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const data = await res.json() as { hires: ManagerHire[]; total: number; hasMore: boolean }
      set(s => ({
        hires:       offset === 0 ? data.hires : [...s.hires, ...data.hires],
        total:       data.total,
        hasMore:     data.hasMore,
        status:      'ready',
        loadingMore: false,
      }))
    } catch {
      set(s => offset === 0 ? { ...s, status: 'error' } : { ...s, loadingMore: false })
    }
  }, [])

  useEffect(() => {
    load('action', 0)
    load('submitted', 0)
  }, [load])

  const loading      = action.status === 'loading'
  const pending      = action.total
  const overdueCount = action.hires.filter(h => h.overdue).length

  return (
    <div className="mgr-page" data-portal="manager">

      <PortalHeader portal="manager" />

      {/* ── HERO ── */}
      <header className="mgr-hero">
        <div className="mgr-hero-orb" />
        <div className="mgr-hero-inner">
          <div className="mgr-hero-tag">
            <span className="mgr-hero-dot" style={{ background: pending > 0 ? '#F59E0B' : '#34D399' }} aria-hidden="true" />
            {loading ? 'Loading' : pending > 0 ? 'Action Required' : 'All Clear'}
          </div>
          <h1>{displayName ? `Welcome back, ${displayName.split(' ')[0]}.` : 'Onboarding Plans'}</h1>
          <p>
            {loading ? 'Loading your new hires…'
              : action.status === 'error' ? 'Your new hires could not be loaded.'
              : pending === 0 ? 'Every onboarding plan is submitted. Nothing outstanding.'
              : `${pending} onboarding plan${pending !== 1 ? 's' : ''} to complete${overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}`}
          </p>
        </div>
      </header>

      {/* ── BODY ── */}
      <main className="mgr-body">
        <SectionBlock
          title="Needs Action"
          state={action}
          emptyTitle="No plans waiting on you"
          emptyText="When HR adds a new hire who reports to you, their onboarding plan will appear here."
          onRetry={() => load('action', 0)}
          onMore={() => load('action', action.hires.length)}
        />
        <SectionBlock
          title="Submitted"
          state={submitted}
          emptyTitle="Nothing submitted yet"
          emptyText="Plans you submit move here. You can still open and update them."
          onRetry={() => load('submitted', 0)}
          onMore={() => load('submitted', submitted.hires.length)}
        />
      </main>
    </div>
  )
}
