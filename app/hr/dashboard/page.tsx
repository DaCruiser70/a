'use client'

import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import '../../../styles/pages/hr-dashboard.css'
import type { NewHireRow } from '@/types'

type ActivityItem = { type: string; msg: string; time: string }

const INITIAL_ACTIVITY: ActivityItem[] = []

const STATUS_LABELS: Record<string,string> = {
  'not-started':'Not Started','in-progress':'In Progress',
  'needs-review':'Needs Review','approved':'Approved','flagged':'Flagged',
}

const PAGE_SIZE = 8

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase()
}

type Hire = NewHireRow

function OfficeLocationBadge({ location }: { location?: string | null }) {
  if (!location) return null
  return (
    <span style={{
      display: 'inline-block', marginTop: '3px',
      fontSize: '10px', fontWeight: 600, letterSpacing: '0.03em',
      color: '#1B3A6B', background: 'rgba(27,58,107,0.1)',
      border: '1px solid rgba(27,58,107,0.2)', borderRadius: '4px', padding: '1px 6px',
    }}>
      {location}
    </span>
  )
}

function HireTable({
  paginated, filtered, currentPage, totalPages, search, filterStatus, activeNav, loading,
  onSearch, onFilter, onPage, onView, onApprove, onFlag,
}: {
  paginated: Hire[]
  filtered: Hire[]
  currentPage: number
  totalPages: number
  search: string
  filterStatus: string
  activeNav: string
  loading: boolean
  onSearch: (v: string) => void
  onFilter: (v: string) => void
  onPage: (p: number) => void
  onView: (id: string) => void
  onApprove: (id: string, name: string, e: React.MouseEvent) => void
  onFlag: (id: string, name: string, e: React.MouseEvent) => void
}) {
  return (
    <div className="hr-table-card">
      <div className="hr-table-header">
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <div className="hr-table-title">
            {activeNav === 'pending' ? 'Pending Review' : activeNav === 'flagged' ? 'Flagged' : 'New Hires'}
          </div>
          <div className="hr-table-count">{filtered.length} records</div>
        </div>
        <div className="hr-table-controls">
          <div className="hr-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input placeholder="Search name, email, role..." value={search} onChange={e => onSearch(e.target.value)} />
          </div>
          <select
            className="hr-filter-btn"
            value={filterStatus}
            onChange={e => onFilter(e.target.value)}
            style={{ appearance:'none', paddingRight:'28px', backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888780' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat:'no-repeat', backgroundPosition:'right 10px center' }}
          >
            <option value="all">All Status</option>
            <option value="not-started">Not Started</option>
            <option value="in-progress">In Progress</option>
            <option value="needs-review">Needs Review</option>
            <option value="approved">Approved</option>
            <option value="flagged">Flagged</option>
          </select>
        </div>
      </div>

      <table className="hr-table">
        <thead>
          <tr>
            <th>New Hire</th><th>Role</th><th>Progress</th><th>Status</th><th>Days Since</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {loading
            ? <tr><td colSpan={6} style={{ textAlign:'center', padding:'3rem', color:'#B0ABA4', fontSize:'13px' }}>Loading…</td></tr>
            : paginated.map(hire => (
            <tr key={hire.id} onClick={() => onView(hire.id)}>
              <td>
                <div className="hr-table-name">
                  <div className="hr-table-avatar">{getInitials(hire.name)}</div>
                  <div>
                    <div className="hr-table-name-text">{hire.name}</div>
                    <div className="hr-table-email">{hire.email}</div>
                  </div>
                </div>
              </td>
              <td>
                <div style={{ color:'#5F5E5A', fontSize:'12px' }}>{hire.role}</div>
                <OfficeLocationBadge location={hire.office_location} />
              </td>
              <td>
                <div className="hr-table-progress-wrap">
                  <div className="hr-table-progress-bar">
                    <div className="hr-table-progress-fill" style={{ width:`${hire.progress}%` }} />
                  </div>
                  <div className="hr-table-progress-pct">{hire.progress}%</div>
                </div>
              </td>
              <td><span className={`hr-status ${hire.status}`}>{STATUS_LABELS[hire.status]}</span></td>
              <td>
                <span className={`hr-days-badge ${hire.days > 5 ? 'urgent' : ''}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width:'11px', height:'11px' }}>
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  {hire.days === 0 ? 'Today' : `${hire.days}d ago`}
                </span>
              </td>
              <td onClick={e => e.stopPropagation()}>
                <div className="hr-table-actions">
                  <button className="hr-table-action-btn view" onClick={e => { e.stopPropagation(); onView(hire.id) }}>View</button>
                  {hire.status === 'needs-review' && (
                    <button className="hr-table-action-btn approve" onClick={e => onApprove(hire.id, hire.name, e)}>Approve</button>
                  )}
                  {hire.status !== 'flagged' && hire.status !== 'approved' && (
                    <button className="hr-table-action-btn flag" onClick={e => onFlag(hire.id, hire.name, e)}>Flag</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!loading && paginated.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign:'center', padding:'3rem', color:'#B0ABA4', fontSize:'13px' }}>
                No records match your search or filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="hr-pagination">
          <div className="hr-pagination-info">
            Showing {((currentPage - 1) * PAGE_SIZE) + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </div>
          <div className="hr-pagination-btns">
            <button className="hr-pagination-btn" disabled={currentPage === 1} onClick={() => onPage(currentPage - 1)}>← Previous</button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
              <button key={page} className={`hr-pagination-btn ${currentPage === page ? 'active' : ''}`} onClick={() => onPage(page)}>{page}</button>
            ))}
            <button className="hr-pagination-btn" disabled={currentPage === totalPages} onClick={() => onPage(currentPage + 1)}>Next →</button>
          </div>
        </div>
      )}
    </div>
  )
}

const EMPTY_HIRE = {
  name: '', preferredName: '', personalEmail: '', aemEmail: '',
  role: '', officeLocation: '', reportingManagerName: '', reportingManagerEmail: '',
  startDate: '', formDeadline: '', probationPeriod: '',
}

type CreatedHire = { name: string; aemEmail: string; personalEmail: string; tempPassword: string }

export default function HRDashboard() {
  const router = useRouter()
  const [hires, setHires]               = useState<NewHireRow[]>([])
  const [activity, setActivity]         = useState<ActivityItem[]>(INITIAL_ACTIVITY)
  const [loading, setLoading]           = useState(true)

  function loadHires() {
    return fetch('/api/hr/hires')
      .then(r => r.json())
      .then(data => { setHires(data.hires ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { loadHires() }, [])

  const [search, setSearch]             = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [activeNav, setActiveNav]       = useState('dashboard')
  const [currentPage, setCurrentPage]   = useState(1)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [submitting, setSubmitting]     = useState(false)
  const [addError, setAddError]         = useState('')
  const [createdHire, setCreatedHire]   = useState<CreatedHire | null>(null)
  const [copied, setCopied]             = useState(false)
  const [showNotifs, setShowNotifs]     = useState(false)
  const [toast, setToast]               = useState<string|null>(null)
  const [newHire, setNewHire]           = useState(EMPTY_HIRE)

  const today = new Date().toLocaleDateString('en-CA', { weekday:'long', month:'long', day:'numeric', year:'numeric' })

  const stats = {
    total:       hires.length,
    needsReview: hires.filter(h => h.status === 'needs-review').length,
    approved:    hires.filter(h => h.status === 'approved').length,
    flagged:     hires.filter(h => h.status === 'flagged').length,
  }
  const completionPct = stats.total === 0 ? 0 : Math.round((stats.approved / stats.total) * 100)

  const filtered   = hires.filter(h => {
    const matchSearch = h.name.toLowerCase().includes(search.toLowerCase()) ||
                        h.email.toLowerCase().includes(search.toLowerCase()) ||
                        h.role.toLowerCase().includes(search.toLowerCase())
    const matchFilter = filterStatus === 'all' || h.status === filterStatus
    return matchSearch && matchFilter
  })
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated  = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function applyFilter(status: string) { setFilterStatus(status); setCurrentPage(1) }
  function applySearch(val: string)    { setSearch(val); setCurrentPage(1) }
  function showToast(msg: string)      { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function navTo(nav: string, filter = 'all') {
    setActiveNav(nav); setFilterStatus(filter); setCurrentPage(1)
  }

  function resetModal() {
    setNewHire(EMPTY_HIRE)
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

  async function handleApprove(id: string, name: string, e: React.MouseEvent) {
    e.stopPropagation()
    await fetch(`/api/hr/hires/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })
    setHires(prev => prev.map((h: NewHireRow) => h.id === id ? { ...h, status: 'approved' as const } : h))
    setActivity(prev => [{ type:'green', msg:`<strong>${name}</strong> approved by HR`, time:'Just now' }, ...prev])
    showToast(`${name} has been approved`)
  }

  async function handleFlag(id: string, name: string, e: React.MouseEvent) {
    e.stopPropagation()
    await fetch(`/api/hr/hires/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'flagged' }),
    })
    setHires(prev => prev.map((h: NewHireRow) => h.id === id ? { ...h, status: 'flagged' as const } : h))
    setActivity(prev => [{ type:'red', msg:`<strong>${name}</strong> flagged for review`, time:'Just now' }, ...prev])
    showToast(`${name} has been flagged`)
  }

  function handleExport() {
    const headers = ['Name','Email','Role','Office Location','Status','Progress','Days Since Submission']
    const rows = hires.map(h => [h.name, h.email, h.role, h.office_location ?? '', STATUS_LABELS[h.status], `${h.progress}%`, h.days === 0 ? 'Today' : `${h.days} days ago`])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type:'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `aem-new-hires-${new Date().toISOString().slice(0,10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    showToast('CSV exported successfully')
  }

  async function handleAddHire(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting || deadlineAfterStart) return
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
        reportingManagerName: newHire.reportingManagerName,
        reportingManagerEmail:newHire.reportingManagerEmail,
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

    // Refresh the hires list with real data from the server
    await loadHires()

    setActivity(prev => [{ type:'navy', msg:`<strong>${newHire.name}</strong> added as new hire`, time:'Just now' }, ...prev])
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

  return (
    <div className="hr-page">

      {/* ── SIDEBAR ── */}
      <aside className="hr-sidebar">
        <div className="hr-sidebar-logo">
          <div className="hr-sidebar-logo-mark">AEM</div>
          <div className="hr-sidebar-logo-label">HR Portal</div>
        </div>
        <nav className="hr-sidebar-nav">
          <div className="hr-nav-section">Main</div>
          <div className={`hr-nav-item ${activeNav === 'dashboard' ? 'active' : ''}`} onClick={() => navTo('dashboard')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            Dashboard
          </div>
          <div className={`hr-nav-item ${activeNav === 'newhires' ? 'active' : ''}`} onClick={() => navTo('newhires', 'all')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            New Hires
            <span className="hr-nav-badge">{stats.total}</span>
          </div>
          <div className={`hr-nav-item ${activeNav === 'pending' ? 'active' : ''}`} onClick={() => navTo('pending', 'needs-review')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            Pending Review
            <span className="hr-nav-badge">{stats.needsReview}</span>
          </div>
          <div className={`hr-nav-item ${activeNav === 'flagged' ? 'active' : ''}`} onClick={() => navTo('flagged', 'flagged')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            Flagged
            <span className="hr-nav-badge-red">{stats.flagged}</span>
          </div>
          <div className="hr-nav-section">Records</div>
          <div className={`hr-nav-item ${activeNav === 'export' ? 'active' : ''}`} onClick={() => { setActiveNav('export'); handleExport() }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            Export Records
          </div>
          <div className="hr-nav-section">Settings</div>
          <div className={`hr-nav-item ${activeNav === 'settings' ? 'active' : ''}`} onClick={() => setActiveNav('settings')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
            Portal Settings
          </div>
        </nav>
        <div className="hr-sidebar-user">
          <div className="hr-sidebar-avatar">HR</div>
          <div className="hr-sidebar-user-info">
            <div className="hr-sidebar-user-name">HR Admin</div>
            <div className="hr-sidebar-user-role">hr@aemltd.com</div>
          </div>
          <button className="hr-sidebar-logout" onClick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); window.location.href = '/login' }} title="Sign out">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="hr-main">
        <div className="hr-topbar">
          <div className="hr-topbar-left">
            <div className="hr-topbar-title">
              {activeNav === 'dashboard' ? 'Dashboard' : activeNav === 'newhires' ? 'New Hires' :
               activeNav === 'pending' ? 'Pending Review' : activeNav === 'flagged' ? 'Flagged' :
               activeNav === 'settings' ? 'Portal Settings' : 'Dashboard'}
            </div>
            <div className="hr-topbar-date">{today}</div>
          </div>
          <div className="hr-topbar-right">
            <button className="hr-topbar-btn secondary" onClick={handleExport}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export CSV
            </button>
            <button className="hr-topbar-btn primary" onClick={openAddModal}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add New Hire
            </button>
            <div className="hr-notif-btn" style={{ position:'relative' }} onClick={() => setShowNotifs(v => !v)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <div className="hr-notif-dot" />
              {showNotifs && (
                <div className="hr-notif-dropdown">
                  <div className="hr-notif-dropdown-title">Notifications</div>
                  {activity.slice(0,4).map((a,i) => (
                    <div key={i} className="hr-notif-item">
                      <div className={`hr-activity-dot ${a.type}`} style={{ width:'10px',height:'10px',flexShrink:0 }}>
                        <div className="hr-activity-dot-inner" style={{ width:'4px',height:'4px' }} />
                      </div>
                      <div>
                        <div className="hr-notif-msg" dangerouslySetInnerHTML={{ __html: a.msg }} />
                        <div className="hr-notif-time">{a.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="hr-content">

          {/* ── DASHBOARD VIEW ── */}
          {activeNav === 'dashboard' && (
            <>
              <div className="hr-stats-row">
                <div className="hr-stat-card navy">
                  <div className="hr-stat-top">
                    <div className="hr-stat-icon navy">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="2" strokeLinecap="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                    </div>
                    <span className="hr-stat-trend up">+3 this week</span>
                  </div>
                  <div className="hr-stat-num">{stats.total}</div>
                  <div className="hr-stat-label">Total New Hires</div>
                </div>
                <div className="hr-stat-card amber">
                  <div className="hr-stat-top">
                    <div className="hr-stat-icon amber">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                    </div>
                    <span className="hr-stat-trend neutral">Awaiting review</span>
                  </div>
                  <div className="hr-stat-num">{stats.needsReview}</div>
                  <div className="hr-stat-label">Pending Review</div>
                </div>
                <div className="hr-stat-card green">
                  <div className="hr-stat-top">
                    <div className="hr-stat-icon green">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="2" strokeLinecap="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                      </svg>
                    </div>
                    <span className="hr-stat-trend up">+1 today</span>
                  </div>
                  <div className="hr-stat-num">{stats.approved}</div>
                  <div className="hr-stat-label">Approved</div>
                </div>
                <div className="hr-stat-card red">
                  <div className="hr-stat-top">
                    <div className="hr-stat-icon red">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#E74C3C" strokeWidth="2" strokeLinecap="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                    </div>
                    <span className="hr-stat-trend down">Needs attention</span>
                  </div>
                  <div className="hr-stat-num">{stats.flagged}</div>
                  <div className="hr-stat-label">Flagged</div>
                </div>
              </div>

              <div className="hr-grid">
                <div className="hr-table-card">
                  <div className="hr-table-header">
                    <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                      <div className="hr-table-title">Recent New Hires</div>
                      <div className="hr-table-count">{hires.length} total</div>
                    </div>
                    <button className="hr-topbar-btn secondary" style={{ fontSize:'11px', padding:'6px 12px' }} onClick={() => navTo('newhires', 'all')}>
                      View all →
                    </button>
                  </div>
                  <table className="hr-table">
                    <thead>
                      <tr><th>New Hire</th><th>Role</th><th>Progress</th><th>Status</th><th>Actions</th></tr>
                    </thead>
                    <tbody>
                      {loading
                        ? <tr><td colSpan={5} style={{ textAlign:'center', padding:'2rem', color:'#B0ABA4', fontSize:'13px' }}>Loading…</td></tr>
                        : hires.slice(0, 5).map(hire => (
                        <tr key={hire.id} onClick={() => router.push(`/hr/newhire/${hire.id}`)}>
                          <td>
                            <div className="hr-table-name">
                              <div className="hr-table-avatar">{getInitials(hire.name)}</div>
                              <div>
                                <div className="hr-table-name-text">{hire.name}</div>
                                <div className="hr-table-email">{hire.email}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div style={{ color:'#5F5E5A', fontSize:'12px' }}>{hire.role}</div>
                            <OfficeLocationBadge location={hire.office_location} />
                          </td>
                          <td>
                            <div className="hr-table-progress-wrap">
                              <div className="hr-table-progress-bar">
                                <div className="hr-table-progress-fill" style={{ width:`${hire.progress}%` }} />
                              </div>
                              <div className="hr-table-progress-pct">{hire.progress}%</div>
                            </div>
                          </td>
                          <td><span className={`hr-status ${hire.status}`}>{STATUS_LABELS[hire.status]}</span></td>
                          <td onClick={e => e.stopPropagation()}>
                            <div className="hr-table-actions">
                              <button className="hr-table-action-btn view" onClick={e => { e.stopPropagation(); router.push(`/hr/newhire/${hire.id}`) }}>View</button>
                              {hire.status === 'needs-review' && <button className="hr-table-action-btn approve" onClick={e => handleApprove(hire.id, hire.name, e)}>Approve</button>}
                              {hire.status !== 'flagged' && hire.status !== 'approved' && <button className="hr-table-action-btn flag" onClick={e => handleFlag(hire.id, hire.name, e)}>Flag</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="hr-side-panel">

                  <div className="hr-quick-card">
                    <div className="hr-quick-title">Completion Overview</div>
                    <div className="hr-completion-wrap">
                      <div className="hr-completion-ring">
                        <svg viewBox="0 0 56 56">
                          <circle className="hr-completion-ring-bg" cx="28" cy="28" r="22"/>
                          <circle className="hr-completion-ring-fill" cx="28" cy="28" r="22" style={{ strokeDashoffset: 138 - (138 * completionPct / 100) }}/>
                        </svg>
                        <div className="hr-completion-pct">{completionPct}%</div>
                      </div>
                      <div className="hr-completion-info">
                        <div className="hr-completion-label">Overall completion</div>
                        <div className="hr-completion-sub">{stats.approved} of {stats.total} fully onboarded</div>
                      </div>
                    </div>
                    {['not-started','in-progress','needs-review','approved','flagged'].map(s => (
                      <div key={s} className="hr-quick-item">
                        <span className="hr-quick-item-label">{STATUS_LABELS[s]}</span>
                        <span className="hr-quick-item-value" style={{ color: s==='approved'?'#0D5C46':s==='flagged'?'#E74C3C':s==='needs-review'?'#C8920A':s==='in-progress'?'#1B3A6B':'#B0ABA4' }}>
                          {hires.filter(h => h.status === s).length}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="hr-activity-card">
                    <div className="hr-activity-header">
                      <div className="hr-activity-title">Recent Activity</div>
                    </div>
                    <div className="hr-activity-list">
                      {activity.slice(0,6).map((a,i) => (
                        <div key={i} className="hr-activity-item">
                          <div className={`hr-activity-dot ${a.type}`}><div className="hr-activity-dot-inner" /></div>
                          <div className="hr-activity-text">
                            <div className="hr-activity-msg" dangerouslySetInnerHTML={{ __html: a.msg }} />
                            <div className="hr-activity-time">{a.time}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ── TABLE VIEWS ── */}
          {(activeNav === 'newhires' || activeNav === 'pending' || activeNav === 'flagged') && (
            <HireTable
              paginated={paginated}
              filtered={filtered}
              currentPage={currentPage}
              totalPages={totalPages}
              search={search}
              filterStatus={filterStatus}
              activeNav={activeNav}
              loading={loading}
              onSearch={applySearch}
              onFilter={applyFilter}
              onPage={setCurrentPage}
              onView={id => router.push(`/hr/newhire/${id}`)}
              onApprove={handleApprove}
              onFlag={handleFlag}
            />
          )}

          {/* ── SETTINGS VIEW ── */}
          {activeNav === 'settings' && (
            <div className="hr-table-card" style={{ padding:'2rem' }}>
              <div className="hr-table-title" style={{ marginBottom:'0.5rem' }}>Portal Settings</div>
              <p style={{ fontSize:'13px', color:'#888780' }}>Settings will be available once Supabase integration is complete.</p>
            </div>
          )}

        </div>
      </div>

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
                  onChange={e => setNewHire(p => ({ ...p, officeLocation: e.target.value }))}
                >
                  <option value="">Select location</option>
                  <option>Dartmouth NS</option>
                  <option>Moncton NB</option>
                  <option>Oakville ON</option>
                  <option>Remote</option>
                </select>
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Reporting Manager Name</label>
                <input
                  style={inputStyle}
                  placeholder="Manager name"
                  value={newHire.reportingManagerName}
                  onChange={e => setNewHire(p => ({ ...p, reportingManagerName: e.target.value }))}
                />
              </div>

              <div style={fieldStyle}>
                <label style={labelStyle}>Reporting Manager Email</label>
                <input
                  type="email"
                  style={inputStyle}
                  placeholder="manager@aemltd.com"
                  value={newHire.reportingManagerEmail}
                  onChange={e => setNewHire(p => ({ ...p, reportingManagerEmail: e.target.value }))}
                />
              </div>

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
