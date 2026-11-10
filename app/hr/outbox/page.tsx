'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import '../../../styles/pages/hr-dashboard.css'
import '../../../styles/pages/hr-outbox.css'
import PortalSwitcher from '@/components/ui/PortalSwitcher'
import Modal from '@/components/ui/Modal'
import { PortalIdentity } from '@/components/ui/PortalName'
import { NOTIFICATION_TEMPLATES, TEMPLATE_LABELS, ERROR_CODE_LABELS, type NotificationTemplate } from '@/lib/notification-templates'
import type { OutboxStatus } from '@/types'

type OutboxItem = {
  id:         string
  template:   string
  hire_name:  string | null
  audience:   string[]          // role labels, never addresses
  status:     OutboxStatus
  attempts:   number
  error_code: string | null
  created_at: string
  sent_at:    string | null
}
type MailMode = 'console' | 'test' | 'live' | 'off'
type RowAction = 'retry' | 'send_now'

const PAGE_SIZE = 25
const MAX_ATTEMPTS = 5
const STATUS_LABELS: Record<OutboxStatus, string> = {
  queued: 'Queued', sending: 'Sending', sent: 'Sent', failed: 'Failed', dead: 'Dead',
}

const MODE_NOTES: Record<MailMode, { title: string; text: string }> = {
  live:    { title: 'Email is on.', text: 'Notifications are sent to the real recipients. Failed ones are retried automatically up to five times.' },
  test:    { title: 'Test mode.', text: 'Every notification goes to the test mailbox only, with the real recipients named at the top. Nobody else receives anything.' },
  console: { title: 'Email is off (console mode).', text: 'Nothing is sent. Notifications stay queued here until email is switched on.' },
  off:     { title: 'Email is not set up.', text: 'Nothing is sent. Notifications stay queued here until the email settings are complete.' },
}

function templateLabel(key: string) {
  return (TEMPLATE_LABELS as Record<string, string>)[key] ?? key
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })
}

// Queued notifications and their delivery state. All data comes from GET /api/hr/outbox; Retry and
// Send now go through POST /api/hr/outbox/[id] (HR can never change recipients or content).
export default function OutboxPage() {
  const [status, setStatus]     = useState<'' | OutboxStatus>('')
  const [template, setTemplate] = useState<'' | NotificationTemplate>('')
  const [offset, setOffset]     = useState(0)
  const [items, setItems]       = useState<OutboxItem[]>([])
  const [total, setTotal]       = useState(0)
  const [mode, setMode]         = useState<MailMode | null>(null)
  const [state, setState]       = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt]   = useState(0)
  const [busy, setBusy]         = useState<string | null>(null)
  const [notice, setNotice]     = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  // Daily reminders pause switch
  const [reminders, setReminders] = useState<{ paused: boolean; changed_at: string | null } | 'error' | null>(null)
  const [confirmPause, setConfirmPause] = useState(false)
  // Clear dead notifications
  const [deadCount, setDeadCount] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearError, setClearError] = useState('')
  const [pauseBusy, setPauseBusy] = useState(false)
  const [pauseError, setPauseError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/hr/reminders', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: { paused: boolean; changed_at: string | null }) => { if (!cancelled) setReminders(d) })
      .catch(() => { if (!cancelled) setReminders('error') })
    return () => { cancelled = true }
  }, [])

  async function clearDead() {
    setClearBusy(true)
    setClearError('')
    try {
      const res = await fetch('/api/hr/outbox/clear-dead', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setClearError(body.error ?? 'That didn’t work. Please try again.'); return }
      setConfirmClear(false)
      setNotice({ kind: 'ok', text: `Cleared ${body.cleared} dead notification${body.cleared === 1 ? '' : 's'}.` })
      setOffset(0)
      setState('loading')
      setAttempt(a => a + 1)
    } catch {
      setClearError('That didn’t work. Please check your connection and try again.')
    } finally {
      setClearBusy(false)
    }
  }

  async function togglePause(paused: boolean) {
    setPauseBusy(true)
    setPauseError('')
    try {
      const res = await fetch('/api/hr/reminders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setPauseError(body.error ?? 'That didn’t work. Please try again.'); return }
      setReminders({ paused: body.paused, changed_at: body.changed_at ?? null })
      setConfirmPause(false)
      setNotice({ kind: 'ok', text: body.paused ? 'Daily reminders are paused.' : 'Daily reminders are back on. Anything missed catches up, one email per person per day.' })
    } catch {
      setPauseError('That didn’t work. Please check your connection and try again.')
    } finally {
      setPauseBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) })
    if (status)   qs.set('status', status)
    if (template) qs.set('template', template)
    fetch(`/api/hr/outbox?${qs}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: { items: OutboxItem[]; total: number; mode: MailMode; dead_count?: number }) => {
        if (cancelled) return
        setItems(d.items)
        setTotal(d.total)
        setMode(d.mode)
        setDeadCount(d.dead_count ?? 0)
        setState('ready')
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [status, template, offset, attempt])

  function changeFilter(update: () => void) {
    update()
    setOffset(0)
    setNotice(null)
    setState('loading')
  }

  function goTo(next: number) {
    setOffset(next)
    setNotice(null)
    setState('loading')
  }

  async function act(item: OutboxItem, action: RowAction) {
    setBusy(`${item.id}:${action}`)
    setNotice(null)
    try {
      const res = await fetch(`/api/hr/outbox/${item.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      if (res.ok) {
        setNotice({ kind: 'ok', text: action === 'retry' ? 'Queued again. It will be sent shortly.' : 'Sending now. Refreshing the list…' })
      } else if (res.status === 404) {
        setNotice({ kind: 'error', text: 'That notification has already moved on. The list has been refreshed.' })
      } else if (res.status === 429) {
        setNotice({ kind: 'error', text: 'Too many requests. Please wait a few minutes and try again.' })
      } else {
        setNotice({ kind: 'error', text: 'That didn’t work. Please try again.' })
      }
    } catch {
      setNotice({ kind: 'error', text: 'That didn’t work. Please check your connection and try again.' })
    } finally {
      setBusy(null)
      // Give the immediate send a moment, then show the new state
      setTimeout(() => setAttempt(a => a + 1), 1500)
    }
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
          {mode && (
            <div className="obx-note" role="note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <div>
                <strong>{MODE_NOTES[mode].title}</strong> {MODE_NOTES[mode].text}{' '}
                Recipients are shown by role; addresses are looked up when each email is sent.
              </div>
            </div>
          )}

          {reminders === null && <div className="obx-skeleton" aria-busy="true" aria-label="Loading the reminder setting" />}
          {reminders === 'error' && (
            <div className="obx-error" role="alert" style={{ marginTop: 12 }}>The reminder setting could not be loaded. Reload the page to try again.</div>
          )}
          {reminders && reminders !== 'error' && (
            <div className={`obx-reminders${reminders.paused ? ' paused' : ''}`} role={reminders.paused ? 'status' : undefined}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {reminders.paused
                  ? <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>
                  : <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>}
              </svg>
              <div className="obx-reminders-text">
                <strong>{reminders.paused ? 'Daily reminders are paused.' : 'Daily reminders are on.'}</strong>{' '}
                {reminders.paused
                  ? 'The morning run queues nothing. When you resume, anything missed catches up, still one email per person per day.'
                  : 'Each business day at 9:00 (Toronto) the portal queues reminders here, at most one email per person.'}
                {reminders.changed_at && <span className="obx-sub">Last changed {fmtDateTime(reminders.changed_at)}</span>}
              </div>
              <button type="button" className="obx-act" onClick={() => { setPauseError(''); setConfirmPause(true) }}>
                {reminders.paused ? 'Resume reminders' : 'Pause reminders'}
              </button>
            </div>
          )}
          {confirmPause && reminders && reminders !== 'error' && (
            <Modal
              title={reminders.paused ? 'Resume daily reminders?' : 'Pause daily reminders?'}
              description={reminders.paused
                ? 'The next morning run queues reminders again. Anything missed while paused catches up, at most one email per person per day.'
                : 'The morning run will queue no reminders until you resume. Other notifications keep going out as usual.'}
              onClose={() => setConfirmPause(false)}
              busy={pauseBusy}
            >
              {pauseError && <div className="ui-modal-error" role="alert">{pauseError}</div>}
              <div className="ui-modal-actions">
                <button type="button" className="ui-btn-cancel" disabled={pauseBusy} onClick={() => setConfirmPause(false)}>Cancel</button>
                <button type="button" className="ui-btn-primary" disabled={pauseBusy} onClick={() => togglePause(!reminders.paused)}>
                  {pauseBusy ? 'Saving…' : reminders.paused ? 'Resume reminders' : 'Pause reminders'}
                </button>
              </div>
            </Modal>
          )}

          {deadCount > 0 && (
            <div className="obx-dead">
              <div className="obx-reminders-text">
                <strong>{deadCount} dead notification{deadCount === 1 ? '' : 's'}.</strong>{' '}
                These failed five times and will not be retried. Retry any you still need, or clear them.
              </div>
              <button type="button" className="obx-act" onClick={() => { setClearError(''); setConfirmClear(true) }}>
                Clear dead notifications
              </button>
            </div>
          )}
          {confirmClear && (
            <Modal
              title={`Delete ${deadCount} dead notification${deadCount === 1 ? '' : 's'}?`}
              description={`This permanently deletes the ${deadCount} notification${deadCount === 1 ? '' : 's'} with status Dead. Queued, sending and sent notifications are not touched, and none of these will be sent again.`}
              onClose={() => setConfirmClear(false)}
              busy={clearBusy}
            >
              {clearError && <div className="ui-modal-error" role="alert">{clearError}</div>}
              <div className="ui-modal-actions">
                <button type="button" className="ui-btn-cancel" disabled={clearBusy} onClick={() => setConfirmClear(false)}>Cancel</button>
                <button type="button" className="ui-btn-primary" disabled={clearBusy} onClick={clearDead}>
                  {clearBusy ? 'Deleting…' : `Delete ${deadCount}`}
                </button>
              </div>
            </Modal>
          )}

          <div className="obx-live" aria-live="polite">
            {notice && <div className={`obx-flash ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : undefined}>{notice.text}</div>}
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
                  : 'Notifications appear here as hires, managers and teams move through onboarding.'}
              </div>
            )}

            {state === 'ready' && items.length > 0 && (
              <ul className="obx-list">
                <li className="obx-row obx-head" aria-hidden="true">
                  <span>Notification</span><span>Hire</span><span>Recipients</span><span>Attempts</span>
                  <span>Created · Sent</span><span>Status</span><span>Action</span>
                </li>
                {items.map(item => {
                  const label   = templateLabel(item.template)
                  const canRetry = item.status === 'failed' || item.status === 'dead'
                  const canSend  = item.status === 'queued' || item.status === 'failed'
                  return (
                    <li key={item.id} className="obx-item">
                      <div className="obx-row">
                        <span className="obx-cell" data-label="Notification">{label}</span>
                        <span className="obx-cell" data-label="Hire">{item.hire_name || '—'}</span>
                        <span className="obx-cell" data-label="Recipients">{item.audience.length ? item.audience.join(', ') : '—'}</span>
                        <span className="obx-cell" data-label="Attempts">{item.attempts} of {MAX_ATTEMPTS}</span>
                        <span className="obx-cell" data-label="Created · Sent">
                          {fmtDateTime(item.created_at)}
                          <span className="obx-sub">{item.sent_at ? `Sent ${fmtDateTime(item.sent_at)}` : 'Not sent yet'}</span>
                        </span>
                        <span className="obx-cell" data-label="Status">
                          <span className={`obx-status ${item.status}`}>{STATUS_LABELS[item.status] ?? item.status}</span>
                          {item.error_code && (
                            <span className="obx-sub">{ERROR_CODE_LABELS[item.error_code] ?? ERROR_CODE_LABELS.unknown}</span>
                          )}
                        </span>
                        <span className="obx-cell obx-actions" data-label="Action">
                          {canRetry && (
                            <button
                              type="button" className="obx-act"
                              disabled={busy !== null}
                              aria-label={`Retry: ${label}${item.hire_name ? `, ${item.hire_name}` : ''}`}
                              onClick={() => act(item, 'retry')}
                            >
                              {busy === `${item.id}:retry` ? 'Retrying…' : 'Retry'}
                            </button>
                          )}
                          {canSend && (
                            <button
                              type="button" className="obx-act"
                              disabled={busy !== null}
                              aria-label={`Send now: ${label}${item.hire_name ? `, ${item.hire_name}` : ''}`}
                              onClick={() => act(item, 'send_now')}
                            >
                              {busy === `${item.id}:send_now` ? 'Sending…' : 'Send now'}
                            </button>
                          )}
                          {!canRetry && !canSend && <span className="obx-sub">—</span>}
                        </span>
                      </div>
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
