'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import '../../../styles/pages/hr-dashboard.css'
import '../../../styles/pages/hr-outbox.css'
import PortalSwitcher from '@/components/ui/PortalSwitcher'
import { PortalIdentity } from '@/components/ui/PortalName'
import { NOTIFICATION_TEMPLATES, TEMPLATE_LABELS, type NotificationTemplate } from '@/lib/notification-templates'
import type { OutboxStatus } from '@/types'

type OutboxItem = {
  id:         string
  template:   string
  hire_name:  string | null
  recipients: string[]
  status:     OutboxStatus
  attempts:   number
  created_at: string
  sent_at:    string | null
}

const PAGE_SIZE = 25
const STATUS_LABELS: Record<OutboxStatus, string> = { pending: 'Pending', sent: 'Sent', failed: 'Failed' }

function templateLabel(key: string) {
  return (TEMPLATE_LABELS as Record<string, string>)[key] ?? key
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
}

// Read-only list of queued notifications. All data comes from GET /api/hr/outbox.
export default function OutboxPage() {
  const [status, setStatus]     = useState<'' | OutboxStatus>('')
  const [template, setTemplate] = useState<'' | NotificationTemplate>('')
  const [offset, setOffset]     = useState(0)
  const [items, setItems]       = useState<OutboxItem[]>([])
  const [total, setTotal]       = useState(0)
  const [state, setState]       = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt]   = useState(0)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (status)   qs.set('status', status)
    if (template) qs.set('template', template)
    fetch(`/api/hr/outbox?${qs}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: { items: OutboxItem[]; total: number }) => {
        if (cancelled) return
        setItems(d.items)
        setTotal(d.total)
        setState('ready')
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [status, template, offset, attempt])

  function changeFilter(update: () => void) {
    update()
    setOffset(0)
    setExpanded({})
    setState('loading')
  }

  function goTo(next: number) {
    setOffset(next)
    setExpanded({})
    setState('loading')
  }

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/login'
  }

  const from = total === 0 ? 0 : offset + 1
  const to   = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className="hr-page" data-portal="hr">

      {/* ── SIDEBAR ── */}
      <aside className="hr-sidebar">
        <div className="hr-sidebar-logo">
          <div className="hr-sidebar-logo-mark">AEM</div>
          <div className="hr-sidebar-logo-label">HR Portal</div>
        </div>
        <PortalSwitcher variant="sidebar" />
        <nav className="hr-sidebar-nav" aria-label="HR portal">
          <div className="hr-nav-section">Main</div>
          <Link href="/hr/dashboard" className="hr-nav-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            Dashboard
          </Link>
          <div className="hr-nav-section">Records</div>
          <Link href="/hr/outbox" className="hr-nav-item active" aria-current="page">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 12h-6l-2 3h-4l-2-3H2"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
            Queued notifications
          </Link>
        </nav>
        <div className="hr-sidebar-user">
          <div className="hr-sidebar-avatar">HR</div>
          <div className="hr-sidebar-user-info">
            <div className="hr-sidebar-user-name">HR Admin</div>
            <div className="hr-sidebar-user-role">hr@aemltd.com</div>
          </div>
          <button className="hr-sidebar-logout" onClick={signOut} title="Sign out" aria-label="Sign out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="hr-main">
        <div className="hr-topbar">
          <div className="hr-topbar-left">
            <Link href="/hr/dashboard" className="obx-back">← Dashboard</Link>
            <PortalIdentity role="hr" tone="light" hrTopbar />
            <h1 className="hr-topbar-title" style={{ margin: 0 }}>Queued notifications</h1>
          </div>
        </div>

        <main className="hr-content">
          <div className="obx-note" role="note">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <div>
              <strong>Read-only.</strong> Email is not switched on yet, so nothing listed here has been sent.
              Until then this page is a testing aid that shows what would go out; once email is on it becomes the delivery log.
            </div>
          </div>

          <div className="hr-table-card">
            <div className="obx-filters">
              <div className="obx-filter">
                <label htmlFor="obx-status">Status</label>
                <select id="obx-status" value={status} onChange={e => changeFilter(() => setStatus(e.target.value as '' | OutboxStatus))}>
                  <option value="">All statuses</option>
                  {(Object.keys(STATUS_LABELS) as OutboxStatus[]).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div className="obx-filter">
                <label htmlFor="obx-template">Notification</label>
                <select id="obx-template" value={template} onChange={e => changeFilter(() => setTemplate(e.target.value as '' | NotificationTemplate))}>
                  <option value="">All notifications</option>
                  {NOTIFICATION_TEMPLATES.map(t => <option key={t} value={t}>{TEMPLATE_LABELS[t]}</option>)}
                </select>
              </div>
              <div className="obx-count" aria-live="polite">
                {state === 'ready' && (total === 0 ? 'No notifications' : `${from}–${to} of ${total}`)}
              </div>
            </div>

            {state === 'loading' && (
              <div className="obx-list" aria-busy="true" aria-label="Loading notifications">
                {[0, 1, 2, 3].map(i => <div key={i} className="obx-skeleton" />)}
              </div>
            )}

            {state === 'error' && (
              <div className="obx-state">
                <div className="obx-error" role="alert">
                  The notifications could not be loaded.
                  <button type="button" onClick={() => { setState('loading'); setAttempt(a => a + 1) }}>Try again</button>
                </div>
              </div>
            )}

            {state === 'ready' && items.length === 0 && (
              <div className="obx-state obx-empty">
                <div className="obx-empty-title">Nothing queued</div>
                {status || template
                  ? 'No notifications match these filters.'
                  : 'Notifications appear here when HR adds a new hire or a manager submits a plan.'}
              </div>
            )}

            {state === 'ready' && items.length > 0 && (
              <ul className="obx-list">
                <li className="obx-row obx-head" aria-hidden="true">
                  <span>Notification</span><span>Hire</span><span>Recipients</span><span>Created</span><span>Status</span>
                </li>
                {items.map(item => {
                  const open = !!expanded[item.id]
                  const panelId = `obx-recipients-${item.id}`
                  return (
                    <li key={item.id} className="obx-item">
                      <div className="obx-row">
                        <span className="obx-cell" data-label="Notification">{templateLabel(item.template)}</span>
                        <span className="obx-cell" data-label="Hire">{item.hire_name || '—'}</span>
                        <span className="obx-cell" data-label="Recipients">
                          <button
                            type="button"
                            className="obx-expand"
                            aria-expanded={open}
                            aria-controls={panelId}
                            onClick={() => setExpanded(e => ({ ...e, [item.id]: !open }))}
                          >
                            {item.recipients.length} recipient{item.recipients.length !== 1 ? 's' : ''}
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                              <polyline points="6 9 12 15 18 9"/>
                            </svg>
                          </button>
                        </span>
                        <span className="obx-cell" data-label="Created">{fmtDateTime(item.created_at)}</span>
                        <span className="obx-cell" data-label="Status">
                          <span className={`obx-status ${item.status}`}>{STATUS_LABELS[item.status] ?? item.status}</span>
                        </span>
                      </div>
                      {open && (
                        <div id={panelId} className="obx-recipients">
                          <div className="obx-recipients-title">Recipients</div>
                          <ul>{item.recipients.map(r => <li key={r}>{r}</li>)}</ul>
                          {item.sent_at && <div className="obx-sent">Sent {fmtDateTime(item.sent_at)}</div>}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}

            {state === 'ready' && total > PAGE_SIZE && (
              <div className="hr-pagination">
                <div className="hr-pagination-info">Showing {from}–{to} of {total}</div>
                <div className="hr-pagination-btns">
                  <button className="hr-pagination-btn" disabled={offset === 0} onClick={() => goTo(Math.max(0, offset - PAGE_SIZE))}>← Previous</button>
                  <button className="hr-pagination-btn" disabled={offset + PAGE_SIZE >= total} onClick={() => goTo(offset + PAGE_SIZE)}>Next →</button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
