'use client'

import { useRouter, useParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import '../../../../styles/pages/hr-newhire.css'
import type { NewHireDetail, FormStatus, HrNote, AuditEntry, NewhireDocument, StakeholderTask } from '@/types'

type HireDetail = NewHireDetail & {
  bank_details?: { institution_number: string; transit_number: string; account_number: string }
  sin?: string
  policy_signature?: string
}

type FlagModal      = { formId: string } | null
type RejectDocModal = { documentId: string } | null

const DOC_SECTION_MAP: { title: string; types: string[] }[] = [
  { title: 'Tax Forms',               types: ['td1_federal', 'td1_provincial'] },
  { title: 'Identity & Insurance',    types: ['drivers_license', 'alternative_id', 'proof_of_insurance'] },
  { title: 'Background Check',        types: ['cpic_background_check'] },
  { title: 'Trade Licenses',          types: ['trade_license'] },
  { title: 'Safety Certifications',   types: ['safety_certification'] },
  { title: 'Work Authorization',      types: ['work_permit'] },
]

const DOC_LABEL_MAP: Record<string, string> = {
  td1_federal:           'TD1 Federal Tax Form',
  td1_provincial:        'TD1 Provincial Tax Form',
  drivers_license:       "Driver's License",
  alternative_id:        'Alternative ID',
  proof_of_insurance:    'Proof of Insurance',
  cpic_background_check: 'CPIC Background Check',
  trade_license:         'Trade License',
  safety_certification:  'Safety Certification',
  work_permit:           'Work Permit',
}

function isExpiringSoon(dateStr: string | null): boolean {
  if (!dateStr) return false
  const diff = new Date(dateStr).getTime() - Date.now()
  return diff > 0 && diff < 90 * 24 * 60 * 60 * 1000
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DocStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string; border: string }> = {
    review:   { label: 'Pending Review', color: '#C8920A', bg: 'rgba(200,146,10,0.1)',  border: 'rgba(200,146,10,0.25)' },
    approved: { label: 'Approved',       color: '#0D5C46', bg: 'rgba(13,92,70,0.1)',    border: 'rgba(13,92,70,0.2)'   },
    rejected: { label: 'Rejected',       color: '#E74C3C', bg: 'rgba(231,76,60,0.1)',   border: 'rgba(231,76,60,0.2)'  },
    pending:  { label: 'Not Uploaded',   color: '#888780', bg: 'rgba(136,135,128,0.1)', border: 'rgba(136,135,128,0.2)' },
  }
  const s = map[status] ?? map.pending
  return (
    <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', color: s.color, background: s.bg, border: `1px solid ${s.border}`, whiteSpace: 'nowrap', letterSpacing: '0.03em' }}>
      {s.label}
    </span>
  )
}

const FORMS = [
  { id:'personal', step:1, name:'Personal Information',     sensitive:false },
  { id:'banking',  step:2, name:'Banking & Direct Deposit', sensitive:true  },
  { id:'sin',      step:3, name:'Social Insurance Number',  sensitive:true  },
  { id:'policy',   step:4, name:'Policy Acknowledgement',   sensitive:false },
]

const EQUIPMENT_LIST = [
  { category: 'Office & Tech', items: [
    { id:'laptop',   label:'Laptop / Computer',    note:'Check with IT' },
    { id:'phone',    label:'Mobile Phone',          note:'Company plan' },
    { id:'email',    label:'Email Account Setup',   note:'IT will configure' },
    { id:'software', label:'Software Licenses',     note:'Role-dependent' },
  ]},
  { category: 'Access & Security', items: [
    { id:'access',   label:'Access Card / Key Fob', note:'Facilities' },
    { id:'parking',  label:'Parking Pass',           note:'If applicable' },
    { id:'vpn',      label:'VPN Access',             note:'IT setup' },
  ]},
  { category: 'Field & Vehicle', items: [
    { id:'gascard',  label:'Gas Card',               note:'Fleet dept' },
    { id:'vehicle',  label:'Company Vehicle',         note:'If role requires' },
    { id:'tools',    label:'Tools & Equipment',       note:'Dept-specific' },
  ]},
  { category: 'Safety', items: [
    { id:'ppe',      label:'PPE Equipment',           note:'Hard hat, vest, boots' },
    { id:'training', label:'Safety Training',         note:'Mandatory first week' },
  ]},
  { category: 'Software — Jonas', items: [
    { id:'jonas_regular', label:'Jonas Access — Regular', note:'Marley Element' },
    { id:'jonas_emobile', label:'Jonas Access — e-Mobile', note:'Marley Element' },
  ]},
]

const FORM_STATUS_LABELS: Record<string,string> = {
  pending:'Not Submitted', review:'Needs Review', approved:'Approved', flagged:'Flagged',
}

// Auto-compute overall status from individual form statuses
function computeStatus(statuses: Record<string, string>): string {
  const vals = Object.values(statuses)
  if (vals.some(s => s === 'flagged'))    return 'flagged'
  if (vals.every(s => s === 'approved'))  return 'approved'
  if (vals.every(s => s === 'pending'))   return 'not-started'
  return 'needs-review'
}

const STATUS_DISPLAY: Record<string, { label: string; color: string; bg: string; border: string }> = {
  'flagged':      { label: 'Flagged',       color: '#E74C3C', bg: 'rgba(231,76,60,0.12)',  border: 'rgba(231,76,60,0.3)'  },
  'approved':     { label: 'Approved',      color: '#4ade80', bg: 'rgba(13,92,70,0.15)',   border: 'rgba(13,92,70,0.3)'   },
  'needs-review': { label: 'Needs Review',  color: '#E8B84B', bg: 'rgba(200,146,10,0.12)', border: 'rgba(200,146,10,0.3)' },
  'not-started':  { label: 'Not Started',   color: 'rgba(255,255,255,0.45)', bg: 'rgba(255,255,255,0.07)', border: 'rgba(255,255,255,0.15)' },
  'in-progress':  { label: 'In Progress',   color: 'rgba(255,255,255,0.7)', bg: 'rgba(255,255,255,0.1)',  border: 'rgba(255,255,255,0.2)'  },
}

function getInitials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase()
}

export default function HRNewHirePage() {
  const router  = useRouter()
  const params  = useParams()
  const hireId  = params?.id as string

  const [hire, setHire]                   = useState<HireDetail | null>(null)
  const [loadError, setLoadError]         = useState(false)
  const [formStatuses, setFormStatuses]   = useState<Record<string, FormStatus>>({})
  const [expandedForms, setExpandedForms] = useState<Record<string,boolean>>({})
  const [checkedItems, setCheckedItems]   = useState<Record<string,boolean>>({})
  const [savedItems, setSavedItems]       = useState<Record<string,boolean>>({})
  const [noteText, setNoteText]           = useState('')
  const [savedNotes, setSavedNotes]       = useState<HrNote[]>([])
  const [auditLog, setAuditLog]           = useState<AuditEntry[]>([])
  const [toast, setToast]                 = useState<string|null>(null)
  const [sensitiveVisible, setSensitiveVisible] = useState<Record<string,boolean>>({})
  const [showAllAudit, setShowAllAudit]   = useState(false)
  const [flagReasons, setFlagReasons]     = useState<Record<string, string | null>>({})
  const [flagModal, setFlagModal]         = useState<FlagModal>(null)
  const [flagReasonInput, setFlagReasonInput] = useState('')
  const [hireDocuments, setHireDocuments]     = useState<NewhireDocument[]>([])
  const [rejectDocModal, setRejectDocModal]   = useState<RejectDocModal>(null)
  const [rejectDocReason, setRejectDocReason] = useState('')
  const [stakeholderTasks, setStakeholderTasks] = useState<(StakeholderTask & { stakeholder_name: string | null })[]>([])

  useEffect(() => {
    fetch(`/api/hr/hires/${hireId}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        const d: HireDetail = data.detail
        setHire(d)
        setFormStatuses(d.form_statuses as Record<string, FormStatus>)
        setFlagReasons(d.flag_reasons ?? {})
        setCheckedItems(d.equipment_items ?? {})
        setSavedItems(d.equipment_items ?? {})
        setSavedNotes(d.notes ?? [])
        setAuditLog(d.audit_log ?? [])
      })
      .catch(() => setLoadError(true))
  }, [hireId])

  useEffect(() => {
    if (!hireId) return
    fetch(`/api/hr/hires/${hireId}/documents`)
      .then(r => r.ok ? r.json() : { documents: [] })
      .then(data => setHireDocuments(data.documents ?? []))
      .catch(() => {})
  }, [hireId])

  useEffect(() => {
    if (!hireId) return
    fetch(`/api/hr/hires/${hireId}/stakeholder-tasks`)
      .then(r => r.ok ? r.json() : { tasks: [] })
      .then(data => setStakeholderTasks(data.tasks ?? []))
      .catch(() => {})
  }, [hireId])

  if (loadError) {
    return (
      <div style={{ display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh',fontFamily:'sans-serif' }}>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:'48px',marginBottom:'1rem' }}>404</div>
          <div style={{ color:'#888',marginBottom:'1.5rem' }}>New hire not found</div>
          <button onClick={() => router.push('/hr/dashboard')} style={{ padding:'10px 20px',background:'#1B3A6B',color:'#fff',border:'none',borderRadius:'8px',cursor:'pointer',fontFamily:'sans-serif' }}>
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  if (!hire) {
    return (
      <div style={{ display:'flex',alignItems:'center',justifyContent:'center',minHeight:'100vh' }}>
        <div style={{ color:'#B0ABA4',fontSize:'14px',fontFamily:'sans-serif' }}>Loading…</div>
      </div>
    )
  }

  const status = computeStatus(formStatuses)
  const sd     = STATUS_DISPLAY[status] || STATUS_DISPLAY['needs-review']

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }

  function addAuditLocal(type: AuditEntry['action_type'], msg: string) {
    const entry: AuditEntry = { id: crypto.randomUUID(), user_id: hireId, action_type: type, message: msg, performed_by: null, created_at: new Date().toISOString() }
    setAuditLog(prev => [entry, ...prev].slice(0, 20))
  }

  async function handleFormApprove(formId: string) {
    const res = await fetch(`/api/hr/hires/${hireId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formId, status: 'approved' }),
    })
    if (!res.ok) { showToast('Update failed'); return }
    const { overallStatus } = await res.json()
    setFormStatuses(prev => ({ ...prev, [formId]: 'approved' }))
    if (overallStatus) setHire(h => h ? { ...h, status: overallStatus } : h)
    addAuditLocal('green', `<strong>HR</strong> approved <strong>${FORMS.find(f=>f.id===formId)?.name}</strong>`)
    showToast(`${FORMS.find(f=>f.id===formId)?.name} approved`)
  }

  function openFlagModal(formId: string) {
    setFlagModal({ formId })
    setFlagReasonInput('')
  }

  async function submitFlagModal() {
    if (!flagModal || flagReasonInput.trim().length < 10) return
    const { formId } = flagModal
    const reason = flagReasonInput.trim()
    const res = await fetch(`/api/hr/hires/${hireId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formId, status: 'flagged', reason }),
    })
    if (!res.ok) { showToast('Update failed'); return }
    const { overallStatus } = await res.json()
    setFormStatuses(prev => ({ ...prev, [formId]: 'flagged' }))
    setFlagReasons(prev => ({ ...prev, [formId]: reason }))
    if (overallStatus) setHire(h => h ? { ...h, status: overallStatus } : h)
    addAuditLocal('red', `<strong>HR</strong> flagged <strong>${FORMS.find(f=>f.id===formId)?.name}</strong>`)
    showToast(`${FORMS.find(f=>f.id===formId)?.name} flagged`)
    setFlagModal(null)
    setFlagReasonInput('')
  }

  async function handleDocumentApprove(documentId: string) {
    const res = await fetch(`/api/hr/hires/${hireId}/documents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, action: 'approve' }),
    })
    if (!res.ok) { showToast('Failed to approve document'); return }
    setHireDocuments(prev => prev.map(d => d.id === documentId ? { ...d, form_status: 'approved' as const } : d))
    showToast('Document approved')
  }

  async function submitDocumentReject() {
    if (!rejectDocModal || rejectDocReason.trim().length < 10) return
    const { documentId } = rejectDocModal
    const res = await fetch(`/api/hr/hires/${hireId}/documents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, action: 'reject', reason: rejectDocReason.trim() }),
    })
    if (!res.ok) { showToast('Failed to reject document'); return }
    const reason = rejectDocReason.trim()
    setHireDocuments(prev => prev.map(d => d.id === documentId ? { ...d, form_status: 'rejected' as const, flag_reason: reason } : d))
    showToast('Document rejected')
    setRejectDocModal(null)
    setRejectDocReason('')
  }

  async function handleDocumentView(documentId: string) {
    const res = await fetch(`/api/hr/hires/${hireId}/documents/${documentId}/view`)
    if (!res.ok) { showToast('Could not load document'); return }
    const { url } = await res.json()
    window.open(url, '_blank')
  }

  async function handleSaveEquipment() {
    // Only notify for items that are newly checked AND have no existing stakeholder task at all.
    // Items with a pending task must not create a duplicate; confirmed items must never reset.
    const existingTaskKeys = new Set(stakeholderTasks.map(t => t.task_key))
    const newlyChecked = Object.entries(checkedItems)
      .filter(([key, val]) => val && !savedItems[key] && !existingTaskKeys.has(key))
      .map(([key]) => key)

    setSavedItems({ ...checkedItems })
    await fetch(`/api/hr/hires/${hireId}/equipment`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: checkedItems }),
    })

    if (newlyChecked.length > 0) {
      const notifyRes = await fetch(`/api/hr/hires/${hireId}/equipment/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newlyCheckedItems: newlyChecked }),
      })
      if (notifyRes.ok) {
        const { tasksCreated } = await notifyRes.json()
        if (tasksCreated > 0) {
          fetch(`/api/hr/hires/${hireId}/stakeholder-tasks`)
            .then(r => r.ok ? r.json() : { tasks: [] })
            .then(data => setStakeholderTasks(data.tasks ?? []))
            .catch(() => {})
        }
      }
    }

    const issuedCount = Object.values(checkedItems).filter(Boolean).length
    addAuditLocal('amber', `<strong>HR</strong> saved equipment provisioning — ${issuedCount} items issued`)
    showToast('Equipment checklist saved')
  }

  async function handleSaveNote(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!noteText.trim()) return
    const res = await fetch(`/api/hr/hires/${hireId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteText }),
    })
    if (!res.ok) { showToast('Failed to save note'); return }
    const { note } = await res.json()
    setSavedNotes(prev => [note, ...prev])
    addAuditLocal('amber', `<strong>HR</strong> added an internal note`)
    setNoteText('')
    showToast('Note saved')
  }

  const allEquipItems  = EQUIPMENT_LIST.flatMap(c => c.items)

  // Index stakeholder tasks by task_key so the render can look up state per item
  type EnrichedTask = StakeholderTask & { stakeholder_name: string | null }
  const tasksByKey: Record<string, EnrichedTask[]> = {}
  for (const t of stakeholderTasks) {
    if (!tasksByKey[t.task_key]) tasksByKey[t.task_key] = []
    tasksByKey[t.task_key].push(t)
  }

  const checkedCount   = allEquipItems.filter(i => checkedItems[i.id]).length
  const equipPct       = Math.round((checkedCount / allEquipItems.length) * 100)
  const approvedForms  = Object.values(formStatuses).filter(s => s === 'approved').length
  const displayedAudit = showAllAudit ? auditLog : auditLog.slice(0, 6)

  return (
    <div className="hr-detail-page">

      {/* ── SIDEBAR ── */}
      <aside className="hr-sidebar">
        <div className="hr-sidebar-logo">
          <div className="hr-sidebar-logo-mark">AEM</div>
          <div className="hr-sidebar-logo-label">HR Portal</div>
        </div>
        <nav className="hr-sidebar-nav">
          <div className="hr-nav-section">Main</div>
          <div className="hr-nav-item" onClick={() => router.push('/hr/dashboard')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            Dashboard
          </div>
          <div className="hr-nav-item active">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
            </svg>
            New Hire Record
          </div>
          <div className="hr-nav-section">Settings</div>
          <div className="hr-nav-item">
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
      <div className="hr-detail-main">

        {/* Topbar — Email only, no manual status buttons */}
        <div className="hr-detail-topbar">
          <div className="hr-detail-topbar-left">
            <button className="hr-detail-back" onClick={() => router.push('/hr/dashboard')}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              Back
            </button>
            <div className="hr-detail-breadcrumb">
              <span>Dashboard</span>
              <span className="hr-detail-breadcrumb-sep">›</span>
              <span>New Hires</span>
              <span className="hr-detail-breadcrumb-sep">›</span>
              <span className="hr-detail-breadcrumb-current">{hire.name}</span>
            </div>
          </div>
          <div className="hr-detail-topbar-right">
            <button className="hr-detail-action-btn email" onClick={() => { window.location.href=`mailto:${hire.email}` }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              Email {hire.name.split(' ')[0]}
            </button>
          </div>
        </div>

        {/* Hero */}
        <div className="hr-detail-hero">
          <div className="hr-detail-hero-inner">
            <div className="hr-detail-hero-avatar">{getInitials(hire.name)}</div>
            <div className="hr-detail-hero-info">
              <div className="hr-detail-hero-name">{hire.name}</div>
              <div className="hr-detail-hero-role">{hire.role}</div>
              <div className="hr-detail-hero-meta">
                <span className="hr-detail-hero-tag">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  {hire.email}
                </span>
                <div className="hr-detail-hero-sep" />
                <span className="hr-detail-hero-tag">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  Start: {hire.start_date}
                </span>
              </div>

              {/* Prominent auto-computed status */}
              <div className="hr-detail-status-banner">
                <span className="hr-detail-status-label">Account is currently:</span>
                <span
                  className="hr-detail-status-value"
                  style={{ color: sd.color, background: sd.bg, border: `1px solid ${sd.border}` }}
                >
                  {sd.label}
                </span>
                <span className="hr-detail-status-hint">
                  {status === 'flagged'      && '— One or more forms have been flagged'}
                  {status === 'approved'     && '— All forms reviewed and approved'}
                  {status === 'needs-review' && '— Forms are pending HR review'}
                  {status === 'not-started'  && '— No forms submitted yet'}
                </span>
              </div>
            </div>

            <div className="hr-detail-hero-progress-right">
              <div className="hr-detail-hero-progress-pct">{approvedForms}/4</div>
              <div className="hr-detail-hero-progress-label">forms approved</div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="hr-detail-content">

          {/* ── LEFT ── */}
          <div>

            {/* Form Review */}
            <div className="hrd-card">
              <div className="hrd-card-header">
                <div className="hrd-card-icon navy">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                </div>
                <div>
                  <div className="hrd-card-title">Form Review</div>
                  <div className="hrd-card-sub">Click View to expand — approve or flag from inside</div>
                </div>
                <div className="hrd-card-header-right" style={{ color: approvedForms === 4 ? '#0D5C46' : '#C8920A' }}>
                  {approvedForms}/4 approved
                </div>
              </div>

              {FORMS.map(form => {
                const fStatus = formStatuses[form.id] || 'pending'
                const isOpen  = expandedForms[form.id]
                const notSubmitted = hire.progress === 0 || (form.id !== 'personal' && fStatus === 'pending' && hire.progress < form.step * 25)

                return (
                  <div key={form.id} className="hrd-form-item">
                    <div className="hrd-form-row">
                      <div className={`hrd-form-step ${fStatus === 'approved' ? 'approved' : fStatus === 'flagged' ? 'flagged' : fStatus === 'review' ? 'review' : 'pending'}`}>
                        {fStatus === 'approved' ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                        ) : fStatus === 'flagged' ? (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        ) : form.step}
                      </div>
                      <div className="hrd-form-info">
                        <div className="hrd-form-name">{form.name}</div>
                        <div className="hrd-form-date">
                          {notSubmitted ? 'Not yet submitted' : `Submitted ${hire.days === 0 ? 'today' : `${hire.days}d ago`}`}
                          {form.sensitive && !notSubmitted ? ' · Encrypted fields' : ''}
                        </div>
                      </div>
                      <span className={`hrd-form-status ${fStatus}`}>{FORM_STATUS_LABELS[fStatus]}</span>
                      {!notSubmitted && (
                        <div className="hrd-form-inline-actions">
                          <button
                            className="hrd-inline-btn expand"
                            onClick={() => setExpandedForms(prev => ({ ...prev, [form.id]: !prev[form.id] }))}
                          >
                            {isOpen ? 'Hide' : 'View'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Expanded */}
                    <div className={`hrd-form-data ${isOpen ? 'open' : ''}`}>
                      <div className="hrd-data-grid">
                        {form.id === 'personal' && (<>
                          <div><div className="hrd-data-label">Full Name</div><div className="hrd-data-value">{hire.name}</div></div>
                          <div><div className="hrd-data-label">Email</div><div className="hrd-data-value">{hire.email}</div></div>
                          <div><div className="hrd-data-label">Phone</div><div className="hrd-data-value">{hire.phone}</div></div>
                          <div><div className="hrd-data-label">Address</div><div className="hrd-data-value">{hire.address}</div></div>
                          <div><div className="hrd-data-label">Emergency Contact</div><div className="hrd-data-value">{hire.emergency_contact}</div></div>
                          <div><div className="hrd-data-label">Emergency Phone</div><div className="hrd-data-value">{hire.emergency_phone}</div></div>
                        </>)}
                        {form.id === 'banking' && (<>
                          <div><div className="hrd-data-label">Bank</div><div className="hrd-data-value">{hire.bank_name}</div></div>
                          <div><div className="hrd-data-label">Account Type</div><div className="hrd-data-value">{hire.account_type}</div></div>
                          <div className="hrd-sensitive-row hrd-data-full">
                            <div className="hrd-sensitive-label">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                              Institution, Transit &amp; Account numbers are AES-256 encrypted
                            </div>
                            <button className="hrd-sensitive-btn" onClick={() => { setSensitiveVisible(p=>({...p,banking:!p.banking})); if(!sensitiveVisible.banking) addAuditLocal('amber','<strong>HR</strong> accessed encrypted banking details') }}>
                              {sensitiveVisible.banking ? 'Hide' : 'View Details'}
                            </button>
                          </div>
                          {sensitiveVisible.banking && hire?.bank_details && (
                            <div className="hrd-data-full">
                              <div className="hrd-data-label">Account Details</div>
                              <div className="hrd-data-value">
                                Institution: {hire.bank_details.institution_number} · Transit: {hire.bank_details.transit_number} · Account: {hire.bank_details.account_number}
                              </div>
                            </div>
                          )}
                          {hire.void_cheque_path && (
                            <div className="hrd-sensitive-row hrd-data-full">
                              <div className="hrd-sensitive-label">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                Void cheque on file
                              </div>
                              <button className="hrd-sensitive-btn" onClick={async () => {
                                const r = await fetch(`/api/hr/hires/${hireId}/void-cheque`)
                                if (r.ok) { const { url } = await r.json(); window.open(url, '_blank') }
                                else showToast('Could not load void cheque')
                              }}>
                                View Void Cheque
                              </button>
                            </div>
                          )}
                        </>)}
                        {form.id === 'sin' && (<>
                          <div className="hrd-sensitive-row hrd-data-full">
                            <div className="hrd-sensitive-label">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                              Social Insurance Number — AES-256 encrypted
                            </div>
                            <button className="hrd-sensitive-btn" onClick={() => { setSensitiveVisible(p=>({...p,sin:!p.sin})); if(!sensitiveVisible.sin) addAuditLocal('amber','<strong>HR</strong> accessed encrypted SIN') }}>
                              {sensitiveVisible.sin ? 'Hide SIN' : 'View SIN'}
                            </button>
                          </div>
                          {sensitiveVisible.sin && (
                            <div className="hrd-data-full">
                              <div className="hrd-data-label">Social Insurance Number</div>
                              <div className="hrd-data-value">
                                {hire?.sin
                                  ? `${hire.sin.slice(0,3)} ${hire.sin.slice(3,6)} ${hire.sin.slice(6)}`
                                  : '—'}
                              </div>
                            </div>
                          )}
                        </>)}
                        {form.id === 'policy' && (<>
                          <div><div className="hrd-data-label">Signed By</div><div className="hrd-data-value">{hire.name}</div></div>
                          <div><div className="hrd-data-label">Date Signed</div><div className="hrd-data-value">{hire.start_date}</div></div>
                          <div className="hrd-data-full"><div className="hrd-data-label">Policies Acknowledged</div><div className="hrd-data-value">Code of Conduct · Health &amp; Safety · Privacy · IT Use · Harassment Policy · Social Media · Conflicts of Interest</div></div>
                        </>)}
                      </div>

                      {fStatus === 'flagged' && flagReasons[form.id] && (
                        <div style={{ background: 'rgba(231,76,60,0.06)', border: '1px solid rgba(231,76,60,0.2)', borderRadius: '8px', padding: '10px 14px', margin: '10px 0' }}>
                          <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#C0392B', fontWeight: 700, marginBottom: '4px' }}>Flag Reason</div>
                          <div style={{ fontSize: '13px', color: '#4A4640' }}>{flagReasons[form.id]}</div>
                        </div>
                      )}

                      {fStatus !== 'approved' && (
                        <div className="hrd-expanded-actions">
                          {(fStatus === 'review' || fStatus === 'flagged') && (
                            <button className="hrd-inline-btn approve" onClick={() => handleFormApprove(form.id)}>
                              ✓ Approve this form
                            </button>
                          )}
                          {fStatus !== 'flagged' && (
                            <button className="hrd-inline-btn flag" onClick={() => openFlagModal(form.id)}>
                              Flag this form
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Equipment */}
            <div className="hrd-card">
              <div className="hrd-card-header">
                <div className="hrd-card-icon amber">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="1.8" strokeLinecap="round">
                    <polyline points="9 11 12 14 22 4"/>
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                  </svg>
                </div>
                <div>
                  <div className="hrd-card-title">Equipment Provisioning</div>
                  <div className="hrd-card-sub">Check off items as they are issued to this new hire</div>
                </div>
                <div className="hrd-card-header-right" style={{ color:'#1B3A6B' }}>{checkedCount}/{allEquipItems.length} issued</div>
              </div>
              <div className="hrd-equip-body">
                <div className="hrd-equip-progress">
                  <div className="hrd-equip-bar-wrap">
                    <div className="hrd-equip-bar-fill" style={{ width:`${equipPct}%` }} />
                  </div>
                  <div className="hrd-equip-pct">{equipPct}%</div>
                </div>
                {EQUIPMENT_LIST.map(cat => (
                  <div key={cat.category} className="hrd-equip-category">
                    <div className="hrd-equip-category-label">{cat.category}</div>
                    <div className="hrd-equip-items">
                      {cat.items.map(item => {
                        const itemTasks   = tasksByKey[item.id] ?? []
                        const isConfirmed = itemTasks.length > 0 && itemTasks.every(t => t.status === 'confirmed')
                        const isPending   = !isConfirmed && itemTasks.some(t => t.status === 'pending')
                        const isChecked   = isConfirmed || (checkedItems[item.id] ?? false)
                        const stakeholderName = itemTasks[0]?.stakeholder_name ?? null

                        return (
                          <div
                            key={item.id}
                            className={`hrd-equip-item ${isChecked ? 'checked' : ''}`}
                            onClick={isConfirmed ? undefined : () => setCheckedItems(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                            style={isConfirmed ? { background: 'rgba(13,92,70,0.06)', cursor: 'not-allowed', opacity: 0.85 } : undefined}
                          >
                            <div
                              className="hrd-equip-checkbox"
                              style={isConfirmed ? { background: '#0D5C46', borderColor: '#0D5C46' } : undefined}
                            >
                              {isChecked && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              )}
                            </div>
                            <div
                              className="hrd-equip-item-label"
                              style={isConfirmed ? { color: '#0D5C46' } : undefined}
                            >
                              {item.label}
                            </div>
                            <div className="hrd-equip-item-note">
                              {isConfirmed ? (
                                <span style={{ color: '#0D5C46', fontWeight: 600 }}>
                                  ✓ Confirmed{stakeholderName ? ` by ${stakeholderName}` : ''}
                                </span>
                              ) : isPending ? (
                                <span style={{ color: '#C8920A' }}>
                                  Awaiting confirmation{stakeholderName ? ` from ${stakeholderName}` : ''}
                                </span>
                              ) : item.note}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
                <div className="hrd-equip-save">
                  <div className="hrd-equip-save-note">
                    {checkedCount !== Object.values(savedItems).filter(Boolean).length
                      ? `${checkedCount - Object.values(savedItems).filter(Boolean).length > 0 ? '+' : ''}${checkedCount - Object.values(savedItems).filter(Boolean).length} unsaved changes`
                      : 'All changes saved'}
                  </div>
                  <button className="hrd-equip-save-btn" onClick={handleSaveEquipment}>
                    Save Provisioning Record
                  </button>
                </div>
              </div>
            </div>

            {/* ── Documents ── */}
            <div className="hrd-card">
              <div className="hrd-card-header">
                <div className="hrd-card-icon navy">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </div>
                <div>
                  <div className="hrd-card-title">Documents</div>
                  <div className="hrd-card-sub">Uploaded documents by the new hire — approve or reject each one</div>
                </div>
                <div className="hrd-card-header-right" style={{ color: '#1B3A6B' }}>
                  {hireDocuments.filter(d => d.form_status === 'approved').length}/{hireDocuments.length} approved
                </div>
              </div>

              {hireDocuments.length === 0 ? (
                <div style={{ padding: '2rem 1.75rem', textAlign: 'center', color: '#B0ABA4', fontSize: '13px' }}>
                  No documents uploaded yet.
                </div>
              ) : (
                <div style={{ padding: '1rem 0' }}>
                  {DOC_SECTION_MAP.map(section => {
                    const sectionDocs = hireDocuments.filter(d => section.types.includes(d.document_type))
                    if (sectionDocs.length === 0) return null
                    return (
                      <div key={section.title}>
                        <div style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#B0ABA4', padding: '0.5rem 1.75rem 0.25rem', marginTop: '0.25rem' }}>
                          {section.title}
                        </div>
                        {sectionDocs.map(doc => (
                          <div key={doc.id} style={{ padding: '0.875rem 1.75rem', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
                                  <span style={{ fontWeight: 600, fontSize: '13px', color: '#1a2e25' }}>{doc.document_label}</span>
                                  <DocStatusBadge status={doc.form_status} />
                                </div>
                                <div style={{ fontSize: '11px', color: '#888780', lineHeight: 1.5 }}>
                                  {doc.file_name}
                                  {doc.file_size ? ` · ${formatBytes(doc.file_size)}` : ''}
                                  {' · '}Uploaded {new Date(doc.uploaded_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                                  {doc.expiry_date && (
                                    <>
                                      {' · '}Expires {doc.expiry_date}
                                      {isExpiringSoon(doc.expiry_date) && (
                                        <span style={{ color: '#C8920A', fontWeight: 700 }}> ⚠ Expiring soon</span>
                                      )}
                                    </>
                                  )}
                                </div>
                                {doc.form_status === 'rejected' && doc.flag_reason && (
                                  <div style={{ marginTop: '6px', padding: '8px 12px', background: 'rgba(231,76,60,0.06)', border: '1px solid rgba(231,76,60,0.2)', borderRadius: '8px', fontSize: '12px', color: '#C0392B' }}>
                                    <strong>Rejection reason:</strong> {doc.flag_reason}
                                  </div>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: '6px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                {(doc.form_status === 'approved' || doc.form_status === 'rejected') && (
                                  <button
                                    className="hrd-inline-btn expand"
                                    onClick={() => handleDocumentView(doc.id)}
                                  >
                                    View
                                  </button>
                                )}
                                {doc.form_status === 'review' && (
                                  <>
                                    <button className="hrd-inline-btn expand" onClick={() => handleDocumentView(doc.id)}>View</button>
                                    <button className="hrd-inline-btn approve" onClick={() => handleDocumentApprove(doc.id)}>✓ Approve</button>
                                    <button className="hrd-inline-btn flag" onClick={() => { setRejectDocModal({ documentId: doc.id }); setRejectDocReason('') }}>Reject</button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Stakeholder Confirmations ── */}
            <div className="hrd-card">
              <div className="hrd-card-header">
                <div className="hrd-card-icon green">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <div>
                  <div className="hrd-card-title">Stakeholder Confirmations</div>
                  <div className="hrd-card-sub">Third-party confirmations for equipment and access items</div>
                </div>
                <div className="hrd-card-header-right" style={{ color: '#0D5C46' }}>
                  {stakeholderTasks.filter(t => t.status === 'confirmed').length}/{stakeholderTasks.length} confirmed
                </div>
              </div>

              {stakeholderTasks.length === 0 ? (
                <div style={{ padding: '2rem 1.75rem', textAlign: 'center', color: '#B0ABA4', fontSize: '13px' }}>
                  No stakeholder tasks created yet. They are generated when equipment items are saved.
                </div>
              ) : (
                <div style={{ padding: '0.5rem 0' }}>
                  {stakeholderTasks.map(task => (
                    <div key={task.id} style={{ padding: '0.875rem 1.75rem', borderTop: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: '#1a2e25', marginBottom: '2px' }}>
                          {task.task_name}
                        </div>
                        <div style={{ fontSize: '11px', color: '#888780' }}>
                          {task.stakeholder_name ?? '—'}
                          {task.confirmed_at && (
                            <> · Confirmed {new Date(task.confirmed_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                          )}
                        </div>
                      </div>
                      <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '100px', whiteSpace: 'nowrap',
                        color:      task.status === 'confirmed' ? '#0D5C46' : '#C8920A',
                        background: task.status === 'confirmed' ? 'rgba(13,92,70,0.1)' : 'rgba(200,146,10,0.1)',
                        border:     `1px solid ${task.status === 'confirmed' ? 'rgba(13,92,70,0.2)' : 'rgba(200,146,10,0.25)'}`,
                      }}>
                        {task.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* ── RIGHT ── */}
          <div className="hr-detail-right">

            <div className="hrd-card">
              <div className="hrd-card-header">
                <div className="hrd-card-icon navy">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
                <div><div className="hrd-card-title">Hire Details</div></div>
              </div>
              <div className="hrd-info-body">

                {/* AEM email */}
                <div className="hrd-info-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                  </svg>
                  <div>
                    <div className="hrd-info-label">AEM Email</div>
                    <div className="hrd-info-value">{hire.email}</div>
                  </div>
                </div>

                {/* Personal email */}
                {hire.personal_email && (
                  <div className="hrd-info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                    </svg>
                    <div>
                      <div className="hrd-info-label">Personal Email</div>
                      <div className="hrd-info-value">
                        <a href={`mailto:${hire.personal_email}`} style={{ color:'#1B3A6B', textDecoration:'none' }}>
                          {hire.personal_email}
                        </a>
                      </div>
                    </div>
                  </div>
                )}

                {/* Preferred name */}
                {hire.preferred_name && (
                  <div className="hrd-info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                    </svg>
                    <div>
                      <div className="hrd-info-label">Preferred Name</div>
                      <div className="hrd-info-value">{hire.preferred_name}</div>
                    </div>
                  </div>
                )}

                {/* Phone */}
                <div className="hrd-info-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6z"/>
                  </svg>
                  <div>
                    <div className="hrd-info-label">Phone</div>
                    <div className="hrd-info-value">{hire.phone}</div>
                  </div>
                </div>

                {/* Start date */}
                <div className="hrd-info-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  <div>
                    <div className="hrd-info-label">Start Date</div>
                    <div className="hrd-info-value">{hire.start_date}</div>
                  </div>
                </div>

                {/* Office location */}
                {hire.office_location && (
                  <div className="hrd-info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                    </svg>
                    <div>
                      <div className="hrd-info-label">Office Location</div>
                      <div className="hrd-info-value">{hire.office_location}</div>
                    </div>
                  </div>
                )}

                {/* Address */}
                <div className="hrd-info-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                  <div>
                    <div className="hrd-info-label">Home Address</div>
                    <div className="hrd-info-value">{hire.address}</div>
                  </div>
                </div>

                {/* Reporting manager */}
                {hire.reporting_manager_name && (
                  <div className="hrd-info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    <div>
                      <div className="hrd-info-label">Reporting Manager</div>
                      <div className="hrd-info-value">{hire.reporting_manager_name}</div>
                      {hire.reporting_manager_email && (
                        <div className="hrd-info-value" style={{ marginTop:'2px' }}>
                          <a href={`mailto:${hire.reporting_manager_email}`} style={{ color:'#1B3A6B', textDecoration:'none', fontSize:'12px' }}>
                            {hire.reporting_manager_email}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Form deadline */}
                {hire.form_deadline && (
                  <div className="hrd-info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    <div>
                      <div className="hrd-info-label">Form Deadline</div>
                      <div className="hrd-info-value">{hire.form_deadline}</div>
                    </div>
                  </div>
                )}

                {/* Probation */}
                {hire.probation_period && (
                  <div className="hrd-info-row">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    <div>
                      <div className="hrd-info-label">Probation Period</div>
                      <div className="hrd-info-value">{hire.probation_period}</div>
                      {hire.probation_end_date && (
                        <div className="hrd-info-value" style={{ marginTop:'2px', fontSize:'12px', color:'#888780' }}>
                          Ends {hire.probation_end_date}
                        </div>
                      )}
                      {hire.probation_status && (
                        <div style={{ marginTop:'4px' }}>
                          <span style={{
                            fontSize:'10px', fontWeight:700, letterSpacing:'0.04em',
                            padding:'2px 7px', borderRadius:'4px',
                            color:  hire.probation_status === 'waived'    ? '#888780' :
                                    hire.probation_status === 'completed'  ? '#0D5C46' : '#C8920A',
                            background: hire.probation_status === 'waived'    ? 'rgba(136,135,128,0.1)' :
                                        hire.probation_status === 'completed'  ? 'rgba(13,92,70,0.1)'    : 'rgba(200,146,10,0.1)',
                            border: `1px solid ${
                              hire.probation_status === 'waived'    ? 'rgba(136,135,128,0.2)' :
                              hire.probation_status === 'completed'  ? 'rgba(13,92,70,0.2)'    : 'rgba(200,146,10,0.2)'
                            }`,
                          }}>
                            {hire.probation_status === 'waived' ? 'Waived' : hire.probation_status === 'completed' ? 'Completed' : 'In Progress'}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Emergency contact */}
                <div className="hrd-info-row">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  <div>
                    <div className="hrd-info-label">Emergency Contact</div>
                    <div className="hrd-info-value">{hire.emergency_contact} · {hire.emergency_phone}</div>
                  </div>
                </div>

              </div>
            </div>

            <div className="hrd-card">
              <div className="hrd-card-header">
                <div className="hrd-card-icon purple">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/>
                  </svg>
                </div>
                <div>
                  <div className="hrd-card-title">HR Notes</div>
                  <div className="hrd-card-sub">Not visible to the new hire</div>
                </div>
              </div>
              <div className="hrd-notes-body">
                {savedNotes.length > 0 && (
                  <div className="hrd-notes-list">
                    {savedNotes.map((note, i) => (
                      <div key={i} className="hrd-note-item">
                        <div className="hrd-note-text">{note.note_text}</div>
                        <div className="hrd-note-meta">{note.creator_name ?? 'HR'} · {new Date(note.created_at).toLocaleString('en-CA', { dateStyle:'medium', timeStyle:'short' })}</div>
                      </div>
                    ))}
                  </div>
                )}
                <form onSubmit={handleSaveNote}>
                  <textarea className="hrd-notes-input" rows={3} placeholder="Add an internal note..." value={noteText} onChange={e => setNoteText(e.target.value)} />
                  <button type="submit" className="hrd-notes-save">Save Note</button>
                </form>
              </div>
            </div>

            <div className="hrd-card">
              <div className="hrd-card-header">
                <div className="hrd-card-icon green">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="1.8" strokeLinecap="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                </div>
                <div>
                  <div className="hrd-card-title">Audit Log</div>
                  <div className="hrd-card-sub">Record of all actions taken</div>
                </div>
              </div>
              <div className="hrd-audit-body">
                {displayedAudit.map((entry, i) => (
                  <div key={i} className="hrd-audit-item">
                    <div className={`hrd-audit-dot ${entry.action_type}`}>
                      <div className="hrd-audit-dot-inner" />
                    </div>
                    <div>
                      <div className="hrd-audit-msg" dangerouslySetInnerHTML={{ __html: entry.message }} />
                      <div className="hrd-audit-time">{new Date(entry.created_at).toLocaleString('en-CA', { dateStyle:'medium', timeStyle:'short' })}</div>
                    </div>
                  </div>
                ))}
                {auditLog.length > 6 && (
                  <div className="hrd-audit-more" onClick={() => setShowAllAudit(v => !v)}>
                    {showAllAudit ? 'Show less' : `Show ${auditLog.length - 6} more entries`}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── FLAG REASON MODAL ── */}
      {flagModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}
          onClick={e => { if (e.target === e.currentTarget) setFlagModal(null) }}>
          <div style={{ background:'#fff', borderRadius:'16px', padding:'28px 28px 24px', maxWidth:'440px', width:'100%', boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ fontFamily:'sans-serif', marginBottom:'18px' }}>
              <div style={{ fontWeight:700, fontSize:'17px', color:'#1A1916', marginBottom:'6px' }}>Flag this form</div>
              <div style={{ fontSize:'13px', color:'#7A7875', lineHeight:1.5 }}>
                Please provide a reason so the new hire knows what to correct.
              </div>
            </div>
            <textarea
              autoFocus
              rows={4}
              placeholder="e.g. Your transit number appears incorrect, please double check and resubmit"
              value={flagReasonInput}
              onChange={e => setFlagReasonInput(e.target.value)}
              style={{
                width:'100%', boxSizing:'border-box', resize:'vertical', padding:'10px 12px',
                border:'1.5px solid rgba(0,0,0,0.15)', borderRadius:'8px', fontFamily:'sans-serif',
                fontSize:'13px', lineHeight:1.5, outline:'none', color:'#1A1916',
              }}
            />
            <div style={{ display:'flex', gap:'10px', justifyContent:'flex-end', marginTop:'16px' }}>
              <button
                onClick={() => setFlagModal(null)}
                style={{ padding:'8px 18px', borderRadius:'8px', border:'1.5px solid rgba(0,0,0,0.12)', background:'#fff', cursor:'pointer', fontFamily:'sans-serif', fontSize:'13px', color:'#4A4640' }}
              >
                Cancel
              </button>
              <button
                onClick={submitFlagModal}
                disabled={flagReasonInput.trim().length < 10}
                style={{
                  padding:'8px 18px', borderRadius:'8px', border:'none',
                  background: flagReasonInput.trim().length >= 10 ? '#E74C3C' : 'rgba(231,76,60,0.35)',
                  color:'#fff', cursor: flagReasonInput.trim().length >= 10 ? 'pointer' : 'not-allowed',
                  fontFamily:'sans-serif', fontSize:'13px', fontWeight:600,
                }}
              >
                Submit Flag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REJECT DOCUMENT MODAL ── */}
      {rejectDocModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'1rem' }}
          onClick={e => { if (e.target === e.currentTarget) { setRejectDocModal(null); setRejectDocReason('') } }}>
          <div style={{ background:'#fff', borderRadius:'16px', padding:'28px 28px 24px', maxWidth:'440px', width:'100%', boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ fontFamily:'sans-serif', marginBottom:'18px' }}>
              <div style={{ fontWeight:700, fontSize:'17px', color:'#1A1916', marginBottom:'6px' }}>Reject Document</div>
              <div style={{ fontSize:'13px', color:'#7A7875', lineHeight:1.5 }}>
                Please provide a reason so the new hire knows what to correct.
              </div>
            </div>
            <textarea
              autoFocus
              rows={4}
              placeholder="e.g. This document is expired — please upload a current version."
              value={rejectDocReason}
              onChange={e => setRejectDocReason(e.target.value)}
              style={{ width:'100%', boxSizing:'border-box', resize:'vertical', padding:'10px 12px', border:'1.5px solid rgba(0,0,0,0.15)', borderRadius:'8px', fontFamily:'sans-serif', fontSize:'13px', lineHeight:1.5, outline:'none', color:'#1A1916' }}
            />
            <div style={{ display:'flex', gap:'10px', justifyContent:'flex-end', marginTop:'16px' }}>
              <button
                onClick={() => { setRejectDocModal(null); setRejectDocReason('') }}
                style={{ padding:'8px 18px', borderRadius:'8px', border:'1.5px solid rgba(0,0,0,0.12)', background:'#fff', cursor:'pointer', fontFamily:'sans-serif', fontSize:'13px', color:'#4A4640' }}
              >
                Cancel
              </button>
              <button
                onClick={submitDocumentReject}
                disabled={rejectDocReason.trim().length < 10}
                style={{
                  padding:'8px 18px', borderRadius:'8px', border:'none',
                  background: rejectDocReason.trim().length >= 10 ? '#E74C3C' : 'rgba(231,76,60,0.35)',
                  color:'#fff', cursor: rejectDocReason.trim().length >= 10 ? 'pointer' : 'not-allowed',
                  fontFamily:'sans-serif', fontSize:'13px', fontWeight:600,
                }}
              >
                Reject Document
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="hr-toast">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width:'15px', height:'15px', flexShrink:0 }}>
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {toast}
        </div>
      )}

    </div>
  )
}