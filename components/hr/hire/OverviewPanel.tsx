'use client'

import { timeAgo } from '@/lib/time-ago'
import type { HireFormId, HireOverview, HireTab } from '@/lib/hr-hire'

// Overview tab, left column: "Needs your attention" and "Progress by area".
// Everything comes from GET /api/hr/hires/[id]/overview; nothing here is a sensitive value.
export default function OverviewPanel({ overview, error, onRetry, onOpen }: {
  overview: HireOverview | null
  error:    boolean
  onRetry:  () => void
  onOpen:   (tab: HireTab, form?: HireFormId) => void
}) {
  if (error) {
    return (
      <div className="hh-error" role="alert">
        The overview could not be loaded. Check your connection and try again.
        <button type="button" className="hh-btn" onClick={onRetry}>Try again</button>
      </div>
    )
  }

  if (!overview) {
    return (
      <div aria-busy="true" aria-label="Loading overview">
        <div className="hh-card hh-skeleton-card"><div className="hh-skeleton" style={{ width: '40%' }} /><div className="hh-skeleton" /><div className="hh-skeleton" /></div>
        <div className="hh-area-grid">
          {[0, 1, 2, 3].map(i => <div key={i} className="hh-area hh-skeleton-card"><div className="hh-skeleton" style={{ width: '50%' }} /><div className="hh-skeleton" /></div>)}
        </div>
      </div>
    )
  }

  return (
    <>
      <section className="hh-card" aria-labelledby="hh-attention-title">
        <div className="hh-card-head">
          <h2 id="hh-attention-title" className="hh-card-title">Needs your attention</h2>
          <p className="hh-card-sub">The next things HR has to do or wait on</p>
        </div>
        {overview.attention.length === 0 ? (
          <div className="hh-allclear">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            <div>
              <div className="hh-allclear-title">All clear</div>
              <div className="hh-allclear-text">Nothing is waiting on HR for this hire right now.</div>
            </div>
          </div>
        ) : (
          <ul className="hh-attention">
            {overview.attention.map(item => (
              <li key={item.key} className="hh-attention-item">
                <span className={`hh-dot ${item.tone}`} aria-hidden="true" />
                <div className="hh-attention-text">
                  <div className="hh-attention-title">{item.title}</div>
                  <div className="hh-attention-detail">
                    {item.detail}{item.at ? ` ${timeAgo(item.at)}.` : ''}
                  </div>
                </div>
                <button type="button" className="hh-btn" onClick={() => onOpen(item.tab, item.form)}>
                  {item.action}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2 className="hh-section-title">Progress by area</h2>
      <div className="hh-area-grid">
        {overview.areas.map(a => {
          const inner = (
            <>
              <span className="hh-area-title">{a.title}</span>
              <span className="hh-area-value">{a.value}</span>
              <span
                className="hh-bar" role="progressbar" aria-label={`${a.title} progress`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.pct}
              >
                <span className={`hh-bar-fill ${a.tone}`} style={{ width: `${a.pct}%` }} />
              </span>
              <span className="hh-area-note">{a.note}</span>
            </>
          )
          // Payroll has no tab of its own on this page, so its card is not a button
          return a.tab === 'overview'
            ? <div key={a.key} className="hh-area static">{inner}</div>
            : <button key={a.key} type="button" className="hh-area" onClick={() => onOpen(a.tab)}>{inner}</button>
        })}
      </div>
    </>
  )
}
