'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import '../../../styles/pages/hr-dashboard.css'
import '../../../styles/pages/hr-hire.css'
import '../../../styles/pages/hr-dash.css'
import { timeAgo } from '@/lib/time-ago'
import PortalSwitcher from '@/components/ui/PortalSwitcher'
import ManagerSelect from '@/components/ui/ManagerSelect'
import { formatPlanDate } from '@/components/ui/PlanBadges'
import Link from 'next/link'
import { isRemoteOffice, regionForOffice } from '@/lib/branches'
import { REGIONS } from '@/lib/regions'
import {
  DASH_FILTERS, DASH_FILTER_LABELS, DASH_PAGE_SIZE, DASH_STATUS_LABELS,
  type DashFilter, type DashResponse,
} from '@/lib/hr-dashboard'
import type { HireStatus, NewHireRow } from '@/types'
import { TOTAL_ITEMS } from '@/lib/hire-status'

// CSV export labels (unchanged from the previous dashboard)
const STATUS_LABELS: Record<string,string> = {
  'not-started':'Not Started','in-progress':'In Progress',
  'needs-review':'Needs Review','approved':'Approved','flagged':'Flagged',
}

const STATUS_PILL: Record<HireStatus, string> = {
  'flagged':      'red',
  'needs-review': 'amber',
  'in-progress':  'navy solid',
  'approved':     'green',
  'not-started':  'grey',
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

function isDashFilter(v: unknown): v is DashFilter {
  return typeof v === 'string' && (DASH_FILTERS as readonly string[]).includes(v)
}

const EMPTY_HIRE = {
  name: '', preferredName: '', personalEmail: '', aemEmail: '',
  role: '', officeLocation: '', region: '', reportingManagerId: '',
  startDate: '', formDeadline: '', probationPeriod: '',
}

type CreatedHire = { name: string; aemEmail: string; personalEmail: string; tempPassword: string }

export default function HRDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // ── View state lives in the URL: ?filter=…&q=…&page=… (validated again on the server) ──
  const rawFilter = searchParams?.get('filter')
  const filter: DashFilter = isDashFilter(rawFilter) ? rawFilter : 'all'
  const q    = (searchParams?.get('q') ?? '').slice(0, 100)
  const page = Math.max(1, Math.min(1000, parseInt(searchParams?.get('page') ?? '1', 10) || 1))

  const [data, setData]         = useState<DashResponse | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [version, setVersion]   = useState(0)
  const [query, setQuery]       = useState(q)
  const [view, setView]         = useState<'dashboard' | 'settings'>('dashboard')
  const [menuOpen, setMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [showAddModal, setShowAddModal] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [submitting, setSubmitting]     = useState(false)
  const [addError, setAddError]         = useState('')
  const [createdHire, setCreatedHire]   = useState<CreatedHire | null>(null)
  const [copied, setCopied]             = useState(false)
  const [toast, setToast]               = useState<string|null>(null)
  const [newHire, setNewHire]           = useState(EMPTY_HIRE)
  const [managerMissing, setManagerMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({ filter, page: String(page) })
    if (q) qs.set('q', q)
    fetch(`/api/hr/dashboard?${qs}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: DashResponse) => { if (!cancelled) { setData(d); setLoadError(false) } })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [filter, q, page, version])

  function setUrl(next: { filter?: DashFilter; q?: string; page?: number }, replace = false) {
    const p = new URLSearchParams(window.location.search)
    const f = next.filter ?? filter
    const s = next.q ?? q
    const n = next.page ?? 1
    if (f === 'all') p.delete('filter'); else p.set('filter', f)
    if (s) p.set('q', s); else p.delete('q')
    if (n <= 1) p.delete('page'); else p.set('page', String(n))
    const url = p.toString() ? `?${p}` : window.location.pathname
    if (replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
  }

  // Search runs on the server as you type (debounced); it resets to page 1
  useEffect(() => {
    if (query.trim() === q) return
    const t = setTimeout(() => setUrl({ q: query.trim().slice(0, 100), page: 1 }, true), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const today = new Date().toLocaleDateString('en-CA', { weekday:'long', month:'long', day:'numeric', year:'numeric' })

  function showToast(msg: string)      { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function resetModal() {
    setNewHire(EMPTY_HIRE)
    setManagerMissing(false)
    setAddError('')
    setSubmitting(false)
  }

  function openAddModal() {
    resetModal()
    setShowAddModal(true)
  }

  function closeAddModal() {
    setShowAddModal(false)
    resetModal()
  }

  // Deadline must not be after start date
  const deadlineAfterStart = newHire.startDate && newHire.formDeadline
    ? newHire.formDeadline > newHire.startDate
    : false

  // Same CSV as before (every hire, same columns). The list is fetched only when exporting.
  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch('/api/hr/hires', { cache: 'no-store' })
      if (!res.ok) { showToast('Export failed'); return }
      const { hires = [] } = await res.json() as { hires: NewHireRow[] }
      // "Items approved" counts the four forms + Documents (computeHireStatus)
      const headers = ['Name','Email','Role','Office Location','Status','Items approved','Days Since Submission']
      const rows = hires.map(h => [h.name, h.email, h.role, h.office_location ?? '', STATUS_LABELS[h.status], `${h.approved_items ?? 0} of ${h.total_items ?? TOTAL_ITEMS}`, h.days === 0 ? 'Today' : `${h.days} days ago`])
      const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
      const blob = new Blob([csv], { type:'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `aem-new-hires-${new Date().toISOString().slice(0,10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      showToast('CSV exported successfully')
    } catch {
      showToast('Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function handleAddHire(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting || deadlineAfterStart) return
    if (!newHire.reportingManagerId) { setManagerMissing(true); return }
    setSubmitting(true)
    setAddError('')

    const res = await fetch('/api/hr/hires', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:                 newHire.name,
        preferredName:        newHire.preferredName,
        personalEmail:        newHire.personalEmail,
        aemEmail:             newHire.aemEmail,
        role:                 newHire.role,
        officeLocation:       newHire.officeLocation,
        // Only Remote sends a region; the server derives every other office's region itself
        ...(isRemoteOffice(newHire.officeLocation) ? { region: newHire.region } : {}),
        reportingManagerId:   newHire.reportingManagerId,
        startDate:            newHire.startDate,
        formDeadline:         newHire.formDeadline,
        probationPeriod:      newHire.probationPeriod,
      }),
    })

    if (!res.ok) {
      const data = await res.json()
      setAddError(data.error ?? 'Failed to add hire — please try again.')
      setSubmitting(false)
      return
    }

    const { tempPassword } = await res.json()

    // Refresh the dashboard with real data from the server
    setVersion(v => v + 1)

    setCreatedHire({ name: newHire.name, aemEmail: newHire.aemEmail, personalEmail: newHire.personalEmail, tempPassword })
    closeAddModal()
    setShowSuccessModal(true)
  }

  function handleCopy() {
    if (!createdHire) return
    navigator.clipboard.writeText(createdHire.tempPassword).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const fieldStyle: React.CSSProperties = {
    display:'flex', flexDirection:'column', gap:'5px', marginBottom:'14px',
  }
  const labelStyle: React.CSSProperties = {
    fontSize:'12px', fontWeight:600, color:'#4A4640', fontFamily:'sans-serif',
  }
  const inputStyle: React.CSSProperties = {
    width:'100%', boxSizing:'border-box', padding:'8px 10px',
    border:'1.5px solid rgba(0,0,0,0.12)', borderRadius:'8px',
    fontFamily:'sans-serif', fontSize:'13px', color:'#1A1916', outline:'none',
    background:'#fff',
  }
  const sectionHeaderStyle: React.CSSProperties = {
    fontWeight:700, fontSize:'11px', color:'#1B3A6B',
    textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:'14px',
  }
  const dividerStyle: React.CSSProperties = {
    borderTop:'1px solid rgba(0,0,0,0.08)', marginTop:'6px', paddingTop:'20px',
  }
  const requiredMark = <span style={{ color:'#E74C3C' }}>*</span>

  const stats      = data?.stats
  const attention  = stats ? stats.flagged + stats.needsReview : 0
  const firstRow   = data ? (data.page - 1) * DASH_PAGE_SIZE + 1 : 0
  const lastRow    = data ? Math.min(data.page * DASH_PAGE_SIZE, data.total) : 0

  const navItem = (label: string, icon: React.ReactNode, onClick: () => void, active = false) => (
    <button type="button" className={`hr-nav-item hd-nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => { setMenuOpen(false); onClick() }}>
      {icon}{label}
    </button>
  )

  return (
    <div className="hr-page hh hd" data-portal="hr">

      {/* ── SIDEBAR (a drawer on small screens) ── */}
      {menuOpen && <div className="hd-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      <aside id="hd-sidebar" className={`hr-sidebar hd-sidebar${menuOpen ? ' open' : ''}`}>
        <div className="hr-sidebar-logo">
          <div className="hr-sidebar-logo-mark">AEM</div>
          <div className="hr-sidebar-logo-label">HR Portal</div>
        </div>
        <PortalSwitcher variant="sidebar" />
        <nav className="hr-sidebar-nav" aria-label="HR portal">
          {navItem('Dashboard', (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
          ), () => setView('dashboard'), view === 'dashboard')}
          {navItem(exporting ? 'Exporting…' : 'Export records', (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          ), handleExport)}
          <Link href="/hr/outbox" className="hr-nav-item hd-nav-item" onClick={() => setMenuOpen(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M22 12h-6l-2 3h-4l-2-3H2"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
            Queued notifications
          </Link>
          {navItem('Portal settings', (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          ), () => setView('settings'), view === 'settings')}
        </nav>
        <div className="hr-sidebar-user">
          <div className="hr-sidebar-avatar">HR</div>
          <div className="hr-sidebar-user-info">
            <div className="hr-sidebar-user-name">HR Admin</div>
            <div className="hr-sidebar-user-role">hr@aemltd.com</div>
          </div>
          <button className="hr-sidebar-logout" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login' }} title="Sign out" aria-label="Sign out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main className="hd-main">
        <div className="hd-container">

          <header className="hd-header">
            <button
              type="button" className="hh-btn secondary hd-menu-btn"
              aria-controls="hd-sidebar" aria-expanded={menuOpen}
              onClick={() => setMenuOpen(v => !v)}
            >
              Menu
            </button>
            <div className="hd-header-text">
              <h1 className="hd-title">{view === 'settings' ? 'Portal settings' : 'New hires'}</h1>
              <p className="hd-date">{today}</p>
            </div>
            <div className="hd-header-actions">
              <button type="button" className="hh-btn secondary" onClick={handleExport} disabled={exporting}>
                {exporting ? 'Exporting…' : 'Export CSV'}
              </button>
              <button type="button" className="hh-btn" onClick={openAddModal}>+ Add new hire</button>
            </div>
          </header>

          {view === 'settings' && (
            <section className="hd-card hd-card-pad">
              <h2 className="hd-card-title">Portal settings</h2>
              <p className="hd-muted">Settings will be available once Supabase integration is complete.</p>
            </section>
          )}

          {view === 'dashboard' && (
            <>
              {loadError && !data && (
                <div className="hh-error" role="alert">
                  The dashboard could not be loaded. Check your connection and try again.
                  <button type="button" className="hh-btn" onClick={() => setVersion(v => v + 1)}>Try again</button>
                </div>
              )}

              {/* ── Tiles ── */}
              <div className="hd-tiles" aria-busy={!stats}>
                {[
                  { key: 'active',  label: 'Active hires', value: stats?.active,      tone: 'navy',
                    note: stats ? `${stats.startingThisMonth} starting this month` : '' },
                  { key: 'review',  label: 'Needs review', value: stats?.needsReview, tone: 'amber', note: 'Waiting on you' },
                  { key: 'flagged', label: 'Flagged',      value: stats?.flagged,     tone: 'red',   note: 'Waiting on the hire' },
                  // Counts every approved hire (the tile has never filtered by month)
                  { key: 'ok',      label: 'Approved',     value: stats?.approved,    tone: 'green', note: `All ${TOTAL_ITEMS} items approved` },
                ].map(t => (
                  <div key={t.key} className={`hd-tile ${t.tone}`}>
                    <div className="hd-tile-num">{t.value ?? <span className="hd-tile-skeleton" aria-hidden="true" />}</div>
                    <div className="hd-tile-label">{t.label}</div>
                    <div className="hd-tile-note">{t.note}</div>
                  </div>
                ))}
              </div>

              {/* ── Attention banner ── */}
              {stats && attention > 0 && (
                <div className="hd-banner" role="status">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <p className="hd-banner-text">
                    <strong>{attention} new hire{attention === 1 ? '' : 's'} need{attention === 1 ? 's' : ''} your attention</strong>
                    {' · '}{stats.flagged} flagged, {stats.needsReview} waiting on your review
                  </p>
                  <button type="button" className="hh-btn" onClick={() => setUrl({ filter: 'attention', page: 1 })}>Show them</button>
                </div>
              )}

              {/* ── Table ── */}
              <section className="hd-card" aria-labelledby="hd-table-title">
                <div className="hd-card-head">
                  <h2 id="hd-table-title" className="hd-card-title">All new hires</h2>
                  <div className="hd-search">
                    <label htmlFor="hd-search-input" className="hh-sr-only">Search by name or email</label>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                      id="hd-search-input"
                      type="search"
                      placeholder="Search by name or email"
                      maxLength={100}
                      value={query}
                      onChange={e => setQuery(e.target.value)}
                    />
                  </div>
                </div>

                <div className="hh-chips hd-chips" role="group" aria-label="Filter new hires">
                  {DASH_FILTERS.map(f => (
                    <button
                      key={f}
                      type="button"
                      className={`hh-chip${f === filter ? ' active' : ''}`}
                      aria-pressed={f === filter}
                      onClick={() => setUrl({ filter: f, page: 1 })}
                    >
                      {DASH_FILTER_LABELS[f]}
                      <span className="hd-chip-count">{data ? data.counts[f] : '–'}</span>
                    </button>
                  ))}
                </div>

                <div className="hd-table-wrap">
                  <table className="hd-table">
                    <caption className="hh-sr-only">
                      New hires{filter !== 'all' ? `, ${DASH_FILTER_LABELS[filter]}` : ''}{q ? `, matching “${q}”` : ''}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">New hire</th>
                        <th scope="col">Role</th>
                        <th scope="col">Starts</th>
                        <th scope="col">Items</th>
                        <th scope="col">Status</th>
                        <th scope="col"><span className="hh-sr-only">Action</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {!data && !loadError && [0, 1, 2, 3].map(i => (
                        <tr key={i} aria-hidden="true">
                          <td colSpan={6}><div className="hh-skeleton" /></td>
                        </tr>
                      ))}
                      {data && data.hires.map(h => (
                        <tr key={h.id} onClick={() => router.push(`/hr/newhire/${h.id}`)}>
                          <td>
                            <div className="hd-person">
                              <span className="hd-avatar" aria-hidden="true">{getInitials(h.name)}</span>
                              <span className="hd-person-text">
                                <span className="hd-person-name">{h.name}</span>
                                <span className="hd-person-email">{h.email}</span>
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className="hd-cell-main">{h.role}</div>
                            {h.office_location && <div className="hd-cell-sub">{h.office_location}</div>}
                          </td>
                          <td className="hd-nowrap">{h.start_date ? formatPlanDate(h.start_date) : '—'}</td>
                          <td>
                            <div className="hd-forms">
                              <span className="hh-bar hd-forms-bar" aria-hidden="true">
                                <span className={`hh-bar-fill ${h.status}`} style={{ width: `${(h.approved / TOTAL_ITEMS) * 100}%` }} />
                              </span>
                              <span className="hd-forms-text">{h.approved} of {TOTAL_ITEMS}</span>
                            </div>
                          </td>
                          <td>
                            <span className={`hh-pill ${STATUS_PILL[h.status]}`}>{DASH_STATUS_LABELS[h.status]}</span>
                            <div className="hd-next">{h.next_step}</div>
                          </td>
                          <td className="hd-action" onClick={e => e.stopPropagation()}>
                            <Link
                              href={`/hr/newhire/${h.id}`}
                              className={`hh-btn${h.status === 'needs-review' ? '' : ' secondary'}`}
                              aria-label={`${h.status === 'needs-review' ? 'Review' : 'Open'} ${h.name}`}
                            >
                              {h.status === 'needs-review' ? 'Review' : 'Open'}
                            </Link>
                          </td>
                        </tr>
                      ))}
                      {data && data.hires.length === 0 && (
                        <tr>
                          <td colSpan={6} className="hd-empty">No new hires match this view.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {data && data.total > 0 && (
                  <nav className="hd-pagination" aria-label="Pages">
                    <div className="hd-muted">Showing {firstRow}–{lastRow} of {data.total}</div>
                    {data.pages > 1 && (
                      <div className="hh-btn-row">
                        <button type="button" className="hh-btn secondary small" disabled={data.page === 1} onClick={() => setUrl({ page: data.page - 1 })}>← Previous</button>
                        {Array.from({ length: data.pages }, (_, i) => i + 1).map(n => (
                          <button
                            key={n} type="button"
                            className={`hh-btn small${n === data.page ? '' : ' secondary'}`}
                            aria-current={n === data.page ? 'page' : undefined}
                            onClick={() => setUrl({ page: n })}
                          >
                            {n}
                          </button>
                        ))}
                        <button type="button" className="hh-btn secondary small" disabled={data.page === data.pages} onClick={() => setUrl({ page: data.page + 1 })}>Next →</button>
                      </div>
                    )}
                  </nav>
                )}
              </section>

              {/* ── Starting soon + Recent activity ── */}
              <div className="hd-pair">
                <section className="hd-card" aria-labelledby="hd-soon-title">
                  <div className="hd-card-head"><h2 id="hd-soon-title" className="hd-card-title">Starting soon</h2></div>
                  {!data ? <div className="hd-card-pad"><div className="hh-skeleton" /><div className="hh-skeleton" /></div>
                    : data.startingSoon.length === 0 ? <p className="hd-empty">Nobody starts in the next 30 days.</p>
                    : (
                      <ul className="hd-list">
                        {data.startingSoon.map(s => (
                          <li key={s.id}>
                            <Link href={`/hr/newhire/${s.id}`} className="hd-list-row">
                              <span className="hd-avatar small" aria-hidden="true">{getInitials(s.name)}</span>
                              <span className="hd-person-text">
                                <span className="hd-person-name">{s.name}</span>
                                <span className="hd-person-email">{s.role}</span>
                              </span>
                              <span className="hd-list-date">{formatPlanDate(s.start_date)}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                </section>

                <section className="hd-card" aria-labelledby="hd-activity-title">
                  <div className="hd-card-head"><h2 id="hd-activity-title" className="hd-card-title">Recent activity</h2></div>
                  {!data ? <div className="hd-card-pad"><div className="hh-skeleton" /><div className="hh-skeleton" /></div>
                    : data.activity.length === 0 ? <p className="hd-empty">No recent activity yet.</p>
                    : (
                      <ul className="hd-list">
                        {data.activity.map(a => (
                          <li key={a.id} className="hd-list-row static">
                            <span className={`hh-dot ${a.tone}`} aria-hidden="true" />
                            <span className="hd-person-text">
                              <span className="hd-activity-text">{a.text}</span>
                              <span className="hd-person-email">{timeAgo(a.at)}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                </section>
              </div>
            </>
          )}
        </div>
      </main>

      {/* ── ADD NEW HIRE MODAL ── */}
      {showAddModal && (
        <div className="hr-modal-overlay" onClick={closeAddModal}>
          <div
            className="hr-modal"
            onClick={e => e.stopPropagation()}
            style={{ maxHeight:'90vh', display:'flex', flexDirection:'column' }}
          >
            <div className="hr-modal-header">
              <div>
                <div className="hr-modal-title">Add New Hire</div>
                <div className="hr-modal-sub">Complete all required fields — they will receive login credentials at their AEM email</div>
              </div>
              <button className="hr-modal-close" onClick={closeAddModal}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <form
              onSubmit={handleAddHire}
              style={{ overflowY:'auto', flex:'1', padding:'20px 24px 0' }}
            >
              {/* ── Personal Information ── */}
              <div style={sectionHeaderStyle}>Personal Information</div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Full Name {requiredMark}</label>
                <input
                  required
                  style={inputStyle}
                  placeholder="Jane Smith"
                  value={newHire.name}
                  onChange={e => setNewHire(p => ({ ...p, name: e.target.value }))}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Preferred Name</label>
                <input
                  style={inputStyle}
                  placeholder="What they like to be called"
                  value={newHire.preferredName}
                  onChange={e => setNewHire(p => ({ ...p, preferredName: e.target.value }))}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Personal Email {requiredMark}</label>
                <input
                  required
                  type="email"
                  style={inputStyle}
                  placeholder="jane@gmail.com"
                  value={newHire.personalEmail}
                  onChange={e => setNewHire(p => ({ ...p, personalEmail: e.target.value }))}
                />
                <span style={{ fontSize:'11px', color:'#888780', marginTop:'2px' }}>
                  All system notifications go here, not their AEM email
                </span>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>AEM Email Address {requiredMark}</label>
                <input
                  required
                  type="email"
                  style={inputStyle}
                  placeholder="firstname.lastname@aemltd.com"
                  value={newHire.aemEmail}
                  onChange={e => setNewHire(p => ({ ...p, aemEmail: e.target.value }))}
                />
              </div>

              {/* ── Role & Location ── */}
              <div style={dividerStyle}>
                <div style={sectionHeaderStyle}>Role &amp; Location</div>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Role / Position {requiredMark}</label>
                <input
                  required
                  style={inputStyle}
                  placeholder="e.g. Energy Auditor"
                  value={newHire.role}
                  onChange={e => setNewHire(p => ({ ...p, role: e.target.value }))}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Office Location {requiredMark}</label>
                <select
                  required
                  style={inputStyle}
                  value={newHire.officeLocation}
                  aria-describedby={regionForOffice(newHire.officeLocation) ? 'add-hire-region-note' : undefined}
                  onChange={e => {
                    const office = e.target.value
                    // The region follows the office straight away; Remote starts blank for HR to choose
                    setNewHire(p => ({ ...p, officeLocation: office, region: regionForOffice(office) ?? '' }))
                  }}
                >
                  <option value="">Select location</option>
                  <option>Dartmouth NS</option>
                  <option>Moncton NB</option>
                  <option>Oakville ON</option>
                  <option>Remote</option>
                </select>
                {regionForOffice(newHire.officeLocation) && (
                  <span id="add-hire-region-note" style={{ fontSize:'11px', color:'#5F5E5A', marginTop:'2px' }}>
                    Region: <strong style={{ color:'#1B3A6B' }}>{regionForOffice(newHire.officeLocation)}</strong>
                  </span>
                )}
              </div>

              {isRemoteOffice(newHire.officeLocation) && (
                <div style={fieldStyle}>
                  <label htmlFor="add-hire-region" style={labelStyle}>Region {requiredMark}</label>
                  <select
                    id="add-hire-region"
                    className="hr-add-region"
                    required
                    style={inputStyle}
                    value={newHire.region}
                    aria-describedby="add-hire-region-help"
                    onChange={e => setNewHire(p => ({ ...p, region: e.target.value }))}
                  >
                    <option value="">Select region</option>
                    {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <span id="add-hire-region-help" style={{ fontSize:'11px', color:'#888780', marginTop:'2px' }}>
                    Remote hires have no office region. Choose the team they will work with.
                  </span>
                </div>
              )}

              <ManagerSelect
                value={newHire.reportingManagerId}
                invalid={managerMissing}
                onChange={id => { setNewHire(p => ({ ...p, reportingManagerId: id })); if (id) setManagerMissing(false) }}
              />

              {/* ── Dates & Deadlines ── */}
              <div style={dividerStyle}>
                <div style={sectionHeaderStyle}>Dates &amp; Deadlines</div>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Start Date {requiredMark}</label>
                <input
                  required
                  type="date"
                  style={inputStyle}
                  value={newHire.startDate}
                  onChange={e => setNewHire(p => ({ ...p, startDate: e.target.value }))}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Form Completion Deadline {requiredMark}</label>
                <input
                  required
                  type="date"
                  style={{ ...inputStyle, borderColor: deadlineAfterStart ? '#E74C3C' : 'rgba(0,0,0,0.12)' }}
                  value={newHire.formDeadline}
                  onChange={e => setNewHire(p => ({ ...p, formDeadline: e.target.value }))}
                />
                {deadlineAfterStart && (
                  <span style={{ fontSize:'12px', color:'#E74C3C', marginTop:'3px' }}>
                    Deadline must not be after the start date
                  </span>
                )}
                {!deadlineAfterStart && (
                  <span style={{ fontSize:'11px', color:'#888780', marginTop:'2px' }}>
                    New hires must complete all forms by this date
                  </span>
                )}
              </div>

              {/* ── Employment Details ── */}
              <div style={dividerStyle}>
                <div style={sectionHeaderStyle}>Employment Details</div>
              </div>

              <div style={{ ...fieldStyle, marginBottom:'0' }}>
                <label style={labelStyle}>Probation Period {requiredMark}</label>
                <select
                  required
                  style={inputStyle}
                  value={newHire.probationPeriod}
                  onChange={e => setNewHire(p => ({ ...p, probationPeriod: e.target.value }))}
                >
                  <option value="">Select period</option>
                  <option>3 Months</option>
                  <option>6 Months</option>
                  <option>Waived</option>
                </select>
              </div>

              <div className="hr-modal-actions" style={{ padding:'16px 0 20px', marginTop:'20px', borderTop:'1px solid rgba(0,0,0,0.08)', display:'flex', flexDirection:'column', gap:'10px' }}>
                {addError && (
                  <div style={{ padding:'10px 12px', background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.25)', borderRadius:'8px', color:'#C0392B', fontSize:'13px', fontFamily:'sans-serif' }}>
                    {addError}
                  </div>
                )}
                <div style={{ display:'flex', gap:'10px', justifyContent:'flex-end' }}>
                  <button type="button" className="hr-modal-cancel" onClick={closeAddModal}>Cancel</button>
                  <button
                    type="submit"
                    className="hr-modal-submit"
                    disabled={submitting || !!deadlineAfterStart}
                    style={{ opacity: submitting || deadlineAfterStart ? 0.6 : 1, cursor: submitting || deadlineAfterStart ? 'not-allowed' : 'pointer' }}
                  >
                    {submitting ? 'Creating…' : 'Add New Hire →'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── SUCCESS MODAL ── */}
      {showSuccessModal && createdHire && (
        <div className="hr-modal-overlay" onClick={() => setShowSuccessModal(false)}>
          <div
            className="hr-modal"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth:'480px', padding:'0' }}
          >
            {/* Green header */}
            <div style={{ background:'linear-gradient(135deg, #0D5C46, #0a7a5f)', borderRadius:'16px 16px 0 0', padding:'28px 28px 24px', textAlign:'center' }}>
              <div style={{ width:'52px', height:'52px', background:'rgba(255,255,255,0.15)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px', border:'2px solid rgba(255,255,255,0.3)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" style={{ width:'26px', height:'26px' }}>
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div style={{ color:'#fff', fontWeight:700, fontSize:'18px', fontFamily:'sans-serif', marginBottom:'6px' }}>
                New Hire Created Successfully
              </div>
              <div style={{ color:'rgba(255,255,255,0.75)', fontSize:'13px', fontFamily:'sans-serif' }}>
                Account is ready — save the temporary password below
              </div>
            </div>

            {/* Body */}
            <div style={{ padding:'24px 28px 28px', fontFamily:'sans-serif' }}>
              {/* Hire info */}
              <div style={{ marginBottom:'20px' }}>
                <div style={{ fontWeight:700, fontSize:'17px', color:'#1A1916', marginBottom:'4px' }}>{createdHire.name}</div>
                <div style={{ fontSize:'13px', color:'#5F5E5A', marginBottom:'2px' }}>{createdHire.aemEmail}</div>
                <div style={{ fontSize:'13px', color:'#5F5E5A' }}>
                  {createdHire.personalEmail}
                  <span style={{ marginLeft:'6px', fontSize:'11px', color:'#888780' }}>— a welcome email will be sent here</span>
                </div>
              </div>

              {/* Temp password */}
              <div style={{ background:'#F5F3EF', border:'1.5px solid rgba(0,0,0,0.1)', borderRadius:'10px', padding:'14px 16px', marginBottom:'12px' }}>
                <div style={{ fontSize:'11px', fontWeight:700, color:'#888780', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'8px' }}>
                  Temporary Password
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                  <code style={{ flex:1, fontSize:'15px', fontFamily:'monospace', color:'#1A1916', letterSpacing:'0.05em', userSelect:'all', wordBreak:'break-all' }}>
                    {createdHire.tempPassword}
                  </code>
                  <button
                    onClick={handleCopy}
                    style={{
                      flexShrink:0, padding:'6px 12px', borderRadius:'6px', border:'1.5px solid rgba(0,0,0,0.15)',
                      background: copied ? '#0D5C46' : '#fff', color: copied ? '#fff' : '#4A4640',
                      cursor:'pointer', fontFamily:'sans-serif', fontSize:'12px', fontWeight:600,
                      transition:'all 0.15s',
                    }}
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div style={{ display:'flex', alignItems:'flex-start', gap:'8px', padding:'10px 12px', background:'rgba(231,76,60,0.06)', border:'1px solid rgba(231,76,60,0.2)', borderRadius:'8px', marginBottom:'20px' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#E74C3C" strokeWidth="2" strokeLinecap="round" style={{ width:'16px', height:'16px', flexShrink:0, marginTop:'1px' }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div style={{ fontSize:'13px', fontWeight:700, color:'#C0392B' }}>
                  Save this password now — it will not be shown again
                </div>
              </div>

              <button
                onClick={() => setShowSuccessModal(false)}
                style={{
                  width:'100%', padding:'11px', background:'#1B3A6B', color:'#fff',
                  border:'none', borderRadius:'10px', cursor:'pointer',
                  fontFamily:'sans-serif', fontSize:'14px', fontWeight:600,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="hr-toast">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width:'16px',height:'16px',flexShrink:0 }}>
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {toast}
        </div>
      )}

    </div>
  )
}
