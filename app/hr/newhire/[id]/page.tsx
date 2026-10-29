'use client'

import { useRouter, useParams, useSearchParams } from 'next/navigation'
import { useState, useEffect, useCallback } from 'react'
import '../../../../styles/pages/hr-newhire.css'
import '../../../../styles/pages/hr-hire.css'
import { timeAgo } from '@/lib/time-ago'
import { groupStakeholderTasks } from '@/lib/stakeholder-groups'
import { SafeMessage } from '@/lib/safe-html'
import PortalSwitcher from '@/components/ui/PortalSwitcher'
import { PortalIdentity } from '@/components/ui/PortalName'
import ManagerPlanCard from '@/components/hr/ManagerPlanCard'
import ClearanceReviewRow from '@/components/hr/ClearanceReviewRow'
import ClearanceTrackerCard from '@/components/hr/ClearanceTrackerCard'
import PmRequestCard from '@/components/hr/PmRequestCard'
import HireRegionRow from '@/components/hr/HireRegionRow'
import HireTabBar, { StatusPill, panelId, tabId, type TabDef } from '@/components/hr/hire/HireTabBar'
import OverviewPanel from '@/components/hr/hire/OverviewPanel'
import AuditLogCard from '@/components/hr/hire/AuditLogCard'
import VehicleRequestRow from '@/components/hr/hire/VehicleRequestRow'
import { VEHICLE_STEP_LABELS, VEHICLE_TASK_KEYS, type VehicleStep } from '@/lib/vehicle'
import RevealModal, { type RevealedBanking, type RevealedPersonal, type RevealResult } from '@/components/hr/hire/RevealModal'
import { PHONE_CHOICE_LABELS, WORK_PHONE_PLATFORM_LABELS, formatDob } from '@/lib/personal-info'
import { REVEAL_VISIBLE_SECONDS, type RevealGroup } from '@/lib/reveal'
import { formatPlanDate } from '@/components/ui/PlanBadges'
import { EQUIPMENT_LIST, ALL_EQUIPMENT_ITEMS } from '@/lib/equipment-items'
import { TOTAL_ITEMS } from '@/lib/hire-status'
import {
  HIRE_FORMS, HIRE_FORM_LABELS, HIRE_TAB_LABELS, isHireForm, isHireTab,
  type HireFormId, type HireOverview, type HireTab, type Tone,
} from '@/lib/hr-hire'
import type { HrClearanceFullView as HrClearanceView } from '@/lib/clearance-package'
import Link from 'next/link'
import type { NewHireDetail, FormStatus, HrNote, AuditEntry, NewhireDocument, StakeholderTask } from '@/types'

// No decrypted SIN or banking number is ever part of this record (has_sin / has_banking only)
type HireDetail = NewHireDetail & { policy_signature?: string }

type FlagModal      = { formId: string } | null
type RejectDocModal = { documentId: string } | null
type LocalAudit     = Pick<AuditEntry, 'id' | 'action_type' | 'message' | 'created_at'>

const DOC_SECTION_MAP: { title: string; types: string[] }[] = [
  { title: 'Tax Forms',               types: ['td1_federal', 'td1_provincial'] },
  { title: 'Identity & Insurance',    types: ['drivers_license', 'alternative_id', 'proof_of_insurance'] },
  { title: 'Background Check',        types: ['cpic_background_check'] },
  { title: 'Trade Licenses',          types: ['trade_license'] },
  { title: 'Safety Certifications',   types: ['safety_certification'] },
  { title: 'Work Authorization',      types: ['work_permit'] },
]

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

const DOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  review:   { label: 'Pending review', tone: 'amber' },
  approved: { label: 'Approved',       tone: 'green' },
  rejected: { label: 'Rejected',       tone: 'red' },
  pending:  { label: 'Not uploaded',   tone: 'grey' },
}

const FORMS: { id: HireFormId; sensitive: boolean }[] = [
  { id: 'personal', sensitive: false },
  { id: 'banking',  sensitive: true  },
  { id: 'sin',      sensitive: true  },
  { id: 'policy',   sensitive: false },
]

const FORM_STATUS: Record<FormStatus, { label: string; tone: Tone }> = {
  pending:  { label: 'Not submitted', tone: 'grey' },
  review:   { label: 'Needs review',  tone: 'amber' },
  approved: { label: 'Approved',      tone: 'green' },
  flagged:  { label: 'Flagged',       tone: 'red' },
}

const ACCOUNT_STATUS: Record<string, { label: string; hint: string }> = {
  'flagged':      { label: 'Flagged',      hint: 'One or more forms have been flagged' },
  'approved':     { label: 'Approved',     hint: 'All forms reviewed and approved' },
  'needs-review': { label: 'Needs review', hint: 'Forms are pending HR review' },
  'not-started':  { label: 'Not started',  hint: 'No forms submitted yet' },
  'in-progress':  { label: 'In progress',  hint: 'The new hire is working through the forms' },
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

export default function HRNewHirePage() {
  const router  = useRouter()
  const params  = useParams()
  const hireId  = params?.id as string
  const searchParams = useSearchParams()

  const [hire, setHire]                   = useState<HireDetail | null>(null)
  const [loadError, setLoadError]         = useState(false)
  const [formStatuses, setFormStatuses]   = useState<Record<string, FormStatus>>({})
  const [checkedItems, setCheckedItems]   = useState<Record<string,boolean>>({})
  const [savedItems, setSavedItems]       = useState<Record<string,boolean>>({})
  const [noteText, setNoteText]           = useState('')
  const [savedNotes, setSavedNotes]       = useState<HrNote[]>([])
  const [toast, setToast]                 = useState<string|null>(null)
  // Revealed SIN / banking / personal values: only after a successful code check, cleared on Hide,
  // after 60 seconds, on a tab or form switch, on a hire change and when the page is left
  const [revealed, setRevealed]       = useState<{ banking?: RevealedBanking; sin?: string; personal?: RevealedPersonal }>({})
  const [revealGroup, setRevealGroup] = useState<RevealGroup | null>(null)
  const [flagReasons, setFlagReasons]     = useState<Record<string, string | null>>({})
  const [flagModal, setFlagModal]         = useState<FlagModal>(null)
  const [flagReasonInput, setFlagReasonInput] = useState('')
  const [hireDocuments, setHireDocuments]     = useState<NewhireDocument[] | null>(null)
  const [rejectDocModal, setRejectDocModal]   = useState<RejectDocModal>(null)
  const [rejectDocReason, setRejectDocReason] = useState('')
  const [stakeholderTasks, setStakeholderTasks] = useState<(StakeholderTask & { stakeholder_name: string | null; has_note: boolean })[] | null>(null)
  // Company vehicle request step (Rob → Heather → Marley); null when the hire has no request
  const [vehicleStep, setVehicleStep]           = useState<VehicleStep | null>(null)
  const [revealedNotes, setRevealedNotes]       = useState<Record<string, string>>({})
  const [fetchingNote, setFetchingNote]         = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups]     = useState<Record<string, boolean>>({})
  const [downloading, setDownloading]           = useState<string | null>(null)
  // Security clearance: tracked apart from the four forms (never in formStatuses or the 4/4 count)
  const [clearance, setClearance]               = useState<HrClearanceView | null>(null)
  const [clearanceVersion, setClearanceVersion] = useState(0)
  // Region (separate from the office): editing can be opened from the Project Management card
  const [editingRegion, setEditingRegion]       = useState(() => searchParams?.get('setRegion') === '1')
  const [pmVersion, setPmVersion]               = useState(0)

  // Overview (attention list, area cards, tab badges); refreshed after every change on the page
  const [overview, setOverview]               = useState<HireOverview | null>(null)
  const [overviewError, setOverviewError]     = useState(false)
  const [overviewVersion, setOverviewVersion] = useState(0)
  const refreshOverview = useCallback(() => setOverviewVersion(v => v + 1), [])

  // Entries added on this page without a reload (shown on top of the audit log, as before)
  const [localAudit, setLocalAudit]           = useState<LocalAudit[]>([])

  // ── Tabs: the selected tab and form live in the URL (?tab=forms&form=banking) ──
  const rawTab  = searchParams?.get('tab')
  const rawForm = searchParams?.get('form')
  const clearanceAvailable = overview ? overview.clearance_required : rawTab === 'clearance'
  const activeTab: HireTab =
    isHireTab(rawTab) && (rawTab !== 'clearance' || clearanceAvailable) ? rawTab : 'overview'

  // A tab's panel mounts the first time it is opened and then stays mounted (hidden), so switching
  // back is instant: no refetch, no flash. Adjusted during render, as React recommends.
  const [visited, setVisited] = useState<ReadonlySet<HireTab>>(() => new Set([activeTab]))
  if (!visited.has(activeTab)) setVisited(new Set([...visited, activeTab]))

  const revealScope = `${hireId}|${activeTab}|${rawForm ?? ''}`
  const [revealScopeSeen, setRevealScopeSeen] = useState(revealScope)
  if (revealScope !== revealScopeSeen) {
    setRevealScopeSeen(revealScope)
    setRevealed({})
    setRevealGroup(null)
  }

  function selectTab(tab: HireTab, form?: HireFormId) {
    const next = new URLSearchParams(window.location.search)
    if (tab === 'overview') next.delete('tab')
    else next.set('tab', tab)
    if (form) next.set('form', form)
    else if (tab !== 'forms') next.delete('form')
    next.delete('setRegion')
    const qs = next.toString()
    window.history.pushState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  // From an attention item or area card. The only Overview target is the region editor.
  function openFromOverview(tab: HireTab, form?: HireFormId) {
    if (tab === 'overview') { setEditingRegion(true); return }
    selectTab(tab, form)
    requestAnimationFrame(() => document.getElementById(tabId(tab))?.focus())
  }

  // ── Loading: the hire record and the overview first ──
  // The hire record (GET /api/hr/hires/[id]) is fetched once per page visit, never on a tab switch.
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
      })
      .catch(() => setLoadError(true))
  }, [hireId])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/hr/hires/${hireId}/overview`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: HireOverview) => { if (!cancelled) { setOverview(d); setOverviewError(false) } })
      .catch(() => { if (!cancelled) setOverviewError(true) })
    return () => { cancelled = true }
  }, [hireId, overviewVersion])

  // Revealed values hide themselves after REVEAL_VISIBLE_SECONDS, one timer per group
  const bankingShown = !!revealed.banking
  const sinShown     = !!revealed.sin
  const personalShown = !!revealed.personal
  useEffect(() => {
    if (!bankingShown) return
    const t = setTimeout(() => setRevealed(r => ({ ...r, banking: undefined })), REVEAL_VISIBLE_SECONDS * 1000)
    return () => clearTimeout(t)
  }, [bankingShown])
  useEffect(() => {
    if (!sinShown) return
    const t = setTimeout(() => setRevealed(r => ({ ...r, sin: undefined })), REVEAL_VISIBLE_SECONDS * 1000)
    return () => clearTimeout(t)
  }, [sinShown])
  useEffect(() => {
    if (!personalShown) return
    const t = setTimeout(() => setRevealed(r => ({ ...r, personal: undefined })), REVEAL_VISIBLE_SECONDS * 1000)
    return () => clearTimeout(t)
  }, [personalShown])
  // Leaving the page (including into the back/forward cache) clears them too
  useEffect(() => {
    const clear = () => setRevealed({})
    window.addEventListener('pagehide', clear)
    return () => window.removeEventListener('pagehide', clear)
  }, [])

  // ── Each other tab's data loads the first time that tab is opened ──
  const formsOpened     = visited.has('forms')
  const equipmentOpened = visited.has('equipment')
  const clearanceOpened = visited.has('clearance')

  useEffect(() => {
    if (!hireId || !formsOpened) return
    fetch(`/api/hr/hires/${hireId}/documents`)
      .then(r => r.ok ? r.json() : { documents: [] })
      .then(data => setHireDocuments(data.documents ?? []))
      .catch(() => setHireDocuments([]))
  }, [hireId, formsOpened])

  useEffect(() => {
    if (!hireId || !clearanceOpened) return
    fetch(`/api/hr/hires/${hireId}/clearance`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then((data: HrClearanceView | null) => setClearance(data))
      .catch(() => {})
  }, [hireId, clearanceOpened, clearanceVersion])

  useEffect(() => {
    if (!hireId || !equipmentOpened) return
    fetch(`/api/hr/hires/${hireId}/stakeholder-tasks`)
      .then(r => r.ok ? r.json() : { tasks: [] })
      .then(data => { setStakeholderTasks(data.tasks ?? []); setVehicleStep(data.vehicle?.step ?? null) })
      .catch(() => setStakeholderTasks([]))
  }, [hireId, equipmentOpened])

  if (loadError) {
    return (
      <div className="hh-fullscreen">
        <div className="hh-fullscreen-inner">
          <div className="hh-fullscreen-code">404</div>
          <div className="hh-fullscreen-text">New hire not found</div>
          <button type="button" className="hh-btn primary" onClick={() => router.push('/hr/dashboard')}>Back to Dashboard</button>
        </div>
      </div>
    )
  }

  if (!hire) {
    return (
      <div className="hh-fullscreen" aria-busy="true">
        <div className="hh-fullscreen-text">Loading…</div>
      </div>
    )
  }

  const status = hire.status
  const sd     = ACCOUNT_STATUS[status] ?? ACCOUNT_STATUS['needs-review']

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }

  // Cards that change state outside this page's handlers report through their toast
  function toastAndRefresh(msg: string) {
    showToast(msg)
    refreshOverview()
  }

  function onRevealed(result: RevealResult) {
    setRevealGroup(null)
    // HR reveals only banking, SIN and personal here (the HR routes refuse any other group)
    if (result.group === 'banking') setRevealed(r => ({ ...r, banking: result.values }))
    else if (result.group === 'sin') setRevealed(r => ({ ...r, sin: result.values }))
    else if (result.group === 'personal') setRevealed(r => ({ ...r, personal: result.values }))
    refreshOverview()
  }

  function addAuditLocal(type: AuditEntry['action_type'], msg: string) {
    const entry: LocalAudit = { id: crypto.randomUUID(), action_type: type, message: msg, created_at: new Date().toISOString() }
    setLocalAudit(prev => [entry, ...prev].slice(0, 20))
  }

  function formName(formId: string) {
    return formId === 'clearance' ? 'Security Clearance' : isHireForm(formId) ? HIRE_FORM_LABELS[formId] : formId
  }

  async function handleFormApprove(formId: string) {
    const res = await fetch(`/api/hr/hires/${hireId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formId, status: 'approved' }),
    })
    if (!res.ok) { showToast('Update failed'); return }
    const { overallStatus } = await res.json()
    if (formId === 'clearance') setClearanceVersion(v => v + 1)
    else setFormStatuses(prev => ({ ...prev, [formId]: 'approved' }))
    if (overallStatus) setHire(h => h ? { ...h, status: overallStatus } : h)
    addAuditLocal('green', `<strong>HR</strong> approved <strong>${formName(formId)}</strong>`)
    showToast(`${formName(formId)} approved`)
    refreshOverview()
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
    if (formId === 'clearance') setClearanceVersion(v => v + 1)
    else {
      setFormStatuses(prev => ({ ...prev, [formId]: 'flagged' }))
      setFlagReasons(prev => ({ ...prev, [formId]: reason }))
    }
    if (overallStatus) setHire(h => h ? { ...h, status: overallStatus } : h)
    addAuditLocal('red', `<strong>HR</strong> flagged <strong>${formName(formId)}</strong>`)
    showToast(`${formName(formId)} flagged`)
    setFlagModal(null)
    setFlagReasonInput('')
    refreshOverview()
  }

  async function handleDocumentApprove(documentId: string) {
    const res = await fetch(`/api/hr/hires/${hireId}/documents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, action: 'approve' }),
    })
    if (!res.ok) { showToast('Failed to approve document'); return }
    setHireDocuments(prev => (prev ?? []).map(d => d.id === documentId ? { ...d, form_status: 'approved' as const } : d))
    showToast('Document approved')
    refreshOverview()
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
    setHireDocuments(prev => (prev ?? []).map(d => d.id === documentId ? { ...d, form_status: 'rejected' as const, flag_reason: reason } : d))
    showToast('Document rejected')
    setRejectDocModal(null)
    setRejectDocReason('')
    refreshOverview()
  }

  async function handleDocumentView(documentId: string) {
    const res = await fetch(`/api/hr/hires/${hireId}/documents/${documentId}/view`)
    if (!res.ok) { showToast('Could not load document'); return }
    const { url } = await res.json()
    window.open(url, '_blank')
  }

  // Fetches a 60-second attachment URL and starts the save in this tab
  async function handleDownload(key: string, endpoint: string) {
    setDownloading(key)
    try {
      const res = await fetch(endpoint)
      if (!res.ok) { showToast('Download failed'); return }
      const { url } = await res.json()
      window.location.href = url
    } catch {
      showToast('Download failed')
    } finally {
      setDownloading(null)
    }
  }

  async function handleSaveEquipment() {
    // A checked item should notify only when no stakeholder_tasks row exists yet for this
    // newhire + task_key. We compare against the DB-sourced existingTaskKeys, not local
    // savedItems state — savedItems can drift out of sync with the database.
    const existingTaskKeys = new Set((stakeholderTasks ?? []).map(t => t.task_key))

    const newlyChecked = Object.entries(checkedItems)
      .filter(([key, val]) => val && !existingTaskKeys.has(key))
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
            .then(data => { setStakeholderTasks(data.tasks ?? []); setVehicleStep(data.vehicle?.step ?? null) })
            .catch(() => {})
        }
      }
    }

    const issuedCount = Object.values(checkedItems).filter(Boolean).length
    addAuditLocal('amber', `<strong>HR</strong> saved equipment provisioning — ${issuedCount} items issued`)
    showToast('Equipment checklist saved')
    refreshOverview()
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

  async function handleViewNote(taskId: string) {
    setFetchingNote(taskId)
    try {
      const res = await fetch(`/api/hr/hires/${hireId}/stakeholder-tasks/${taskId}/note`)
      if (!res.ok) { showToast('Could not load note'); return }
      const { note } = await res.json()
      setRevealedNotes(prev => ({ ...prev, [taskId]: note as string }))
    } catch {
      showToast('Could not load note')
    } finally {
      setFetchingNote(null)
    }
  }

  function handleHideNote(taskId: string) {
    setRevealedNotes(prev => {
      const next = { ...prev }
      delete next[taskId]
      return next
    })
  }

  // Index stakeholder tasks by task_key so the render can look up state per item
  type EnrichedTask = StakeholderTask & { stakeholder_name: string | null; has_note: boolean }
  const tasksByKey: Record<string, EnrichedTask[]> = {}
  for (const t of stakeholderTasks ?? []) {
    if (!tasksByKey[t.task_key]) tasksByKey[t.task_key] = []
    tasksByKey[t.task_key].push(t)
  }

  // With a vehicle request, its tasks are shown as one vehicle row (VehicleRequestRow), not as groups
  const groupedTasks = groupStakeholderTasks(
    (stakeholderTasks ?? []).filter(t => !(vehicleStep && VEHICLE_TASK_KEYS.includes(t.task_key))),
  )

  // Progress bar: for items with stakeholder tasks, "done" = all tasks confirmed.
  // For HR-only items (no tasks), "done" = HR's checkbox. Company Vehicle with a request: done only
  // when the request is complete (same rule as equipmentProgress).
  const checkedCount = ALL_EQUIPMENT_ITEMS.filter(item => {
    if (item.id === 'vehicle' && vehicleStep) return vehicleStep === 'complete'
    const tasks = tasksByKey[item.id] ?? []
    if (tasks.length > 0) return tasks.every(t => t.status === 'confirmed')
    return checkedItems[item.id] ?? false
  }).length

  // Used only for the "unsaved changes" label (compares HR's current vs saved checkbox state).
  const localCheckedCount = ALL_EQUIPMENT_ITEMS.filter(i => checkedItems[i.id]).length
  const equipPct       = Math.round((checkedCount / ALL_EQUIPMENT_ITEMS.length) * 100)
  const approvedForms  = Object.values(formStatuses).filter(s => s === 'approved').length
  // Items approved (four forms + Documents), from computeHireStatus on the server: the overview is
  // refreshed after every change; the hire record covers the first paint
  const approvedItems  = overview?.approved ?? hire.approved_items ?? approvedForms
  const totalItems     = overview?.total_items ?? hire.total_items ?? TOTAL_ITEMS
  const docsItem       = overview?.documents ?? null

  // Selected form: from the URL, else the first that needs HR, else the first form
  const statusOf = (f: HireFormId): FormStatus => formStatuses[f] ?? 'pending'
  const selectedForm: HireFormId = isHireForm(rawForm) ? rawForm
    : HIRE_FORMS.find(f => statusOf(f) === 'flagged') ?? HIRE_FORMS.find(f => statusOf(f) === 'review') ?? 'personal'
  const selStatus = statusOf(selectedForm)
  const selMeta   = FORMS.find(f => f.id === selectedForm)!

  const startText = hire.start_date && hire.start_date !== '—' ? `Starts ${formatPlanDate(hire.start_date)}` : null
  const tabs: TabDef[] = (['overview', 'forms', 'equipment', 'plan', 'clearance', 'activity'] as HireTab[])
    .filter(t => t !== 'clearance' || clearanceAvailable)
    .map(t => ({ id: t, label: HIRE_TAB_LABELS[t], badge: overview?.badges[t] }))

  const panel = (t: HireTab, children: React.ReactNode) => visited.has(t) && (
    <div
      key={t}
      role="tabpanel"
      id={panelId(t)}
      aria-labelledby={tabId(t)}
      hidden={activeTab !== t}
      tabIndex={0}
      className="hh-panel"
    >
      {children}
    </div>
  )

  return (
    <div className="hr-detail-page hh" data-portal="hr">

      {/* ── SIDEBAR ── */}
      <aside className="hr-sidebar">
        <div className="hr-sidebar-logo">
          <div className="hr-sidebar-logo-mark">AEM</div>
          <div className="hr-sidebar-logo-label">HR Portal</div>
        </div>
        <PortalSwitcher variant="sidebar" />
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
          <Link href="/hr/outbox" className="hr-nav-item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M22 12h-6l-2 3h-4l-2-3H2"/>
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
            </svg>
            Queued notifications
          </Link>
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

        {/* Portal identity and the email shortcut (kept from the old top bar) */}
        <div className="hh-topbar-wrap">
          <div className="hh-topbar">
            <PortalIdentity role="hr" tone="light" hrTopbar />
            <a className="hh-btn" href={`mailto:${hire.email}`}>Email {hire.name.split(' ')[0]}</a>
          </div>
        </div>

        {/* ── HEADER (always visible) ── */}
        <header className="hh-header">
          <div className="hh-header-inner">
            <Link href="/hr/dashboard" className="hh-back">← All new hires</Link>
            <div className="hh-header-row">
              <div className="hh-avatar" aria-hidden="true">{getInitials(hire.name)}</div>
              <div className="hh-header-main">
                <h1 className="hh-name">{hire.name}</h1>
                <p className="hh-meta">{[hire.role !== '—' ? hire.role : null, hire.office_location, startText].filter(Boolean).join(' · ')}</p>
                <div className="hh-status-line">
                  <span>Account is currently</span>
                  <span className={`hh-status ${status}`}>{sd.label}</span>
                  <span className="hh-status-hint">{sd.hint}</span>
                </div>
              </div>
              <div className="hh-count" aria-label={`${approvedItems} of ${totalItems} items approved`}>
                <div className="hh-count-num" aria-hidden="true">{approvedItems}/{totalItems}</div>
                <div className="hh-count-label" aria-hidden="true">items approved</div>
              </div>
            </div>
          </div>
        </header>

        <HireTabBar tabs={tabs} active={activeTab} onSelect={t => selectTab(t)} />

        <div className="hh-body">

          {/* ── OVERVIEW ── */}
          {panel('overview', (
            <div className="hh-split">
              <div className="hh-col">
                <OverviewPanel
                  overview={overview}
                  error={overviewError && !overview}
                  onRetry={refreshOverview}
                  onOpen={openFromOverview}
                />
              </div>

              <div className="hh-col">
                <div className="hrd-card">
                  <div className="hrd-card-header">
                    <div className="hrd-card-icon navy">
                      <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                    </div>
                    <div><h2 className="hrd-card-title">Hire details</h2></div>
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
                            <a href={`mailto:${hire.personal_email}`} className="hh-link">{hire.personal_email}</a>
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

                    {/* Region (HR can set or change it; not tied to the office once saved) */}
                    <HireRegionRow
                      hireId={hireId}
                      region={hire.region}
                      editing={editingRegion}
                      onEditingChange={setEditingRegion}
                      onSaved={region => { setHire(h => h ? { ...h, region } : h); setPmVersion(v => v + 1); refreshOverview() }}
                      onToast={showToast}
                    />

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
                            <div className="hrd-info-value hh-info-sub">
                              <a href={`mailto:${hire.reporting_manager_email}`} className="hh-link">{hire.reporting_manager_email}</a>
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
                            <div className="hrd-info-value hh-info-sub muted">Ends {hire.probation_end_date}</div>
                          )}
                          {hire.probation_status && (
                            <div className="hh-info-sub">
                              <StatusPill tone={hire.probation_status === 'waived' ? 'grey' : hire.probation_status === 'completed' ? 'green' : 'amber'}>
                                {hire.probation_status === 'waived' ? 'Waived' : hire.probation_status === 'completed' ? 'Completed' : 'In progress'}
                              </StatusPill>
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

                    {/* Employee ID (set by Payroll) */}
                    {hire.employee_id && (
                      <div className="hrd-info-row">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8l-2 4h12z"/>
                        </svg>
                        <div>
                          <div className="hrd-info-label">Employee ID</div>
                          <div className="hrd-info-value hh-mono">
                            {hire.employee_id}
                            {hire.payroll_completed_at && (
                              <span className="hh-info-sub muted"> Payroll completed {new Date(hire.payroll_completed_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                  </div>
                </div>

                <section className="hh-card" aria-labelledby="hh-latest-title">
                  <div className="hh-card-head row">
                    <h2 id="hh-latest-title" className="hh-card-title">Latest activity</h2>
                    <button type="button" className="hh-btn secondary" onClick={() => openFromOverview('activity')}>See all</button>
                  </div>
                  {!overview ? (
                    <div className="hh-card-body" aria-busy="true"><div className="hh-skeleton" /><div className="hh-skeleton" /></div>
                  ) : overview.latest.length === 0 ? (
                    <div className="hh-empty">No activity recorded yet.</div>
                  ) : (
                    <ol className="hh-audit">
                      {overview.latest.map(e => (
                        <li key={e.id} className="hh-audit-item">
                          <div>
                            <div className="hh-audit-msg"><SafeMessage message={e.message} /></div>
                            <div className="hh-audit-time">{new Date(e.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </div>
            </div>
          ))}

          {/* ── FORMS & DOCUMENTS ── */}
          {panel('forms', (
            <>
              <div className="hh-master">
                <section className="hh-card hh-master-list" aria-labelledby="hh-forms-title">
                  <div className="hh-card-head row">
                    <div>
                      <h2 id="hh-forms-title" className="hh-card-title">Form review</h2>
                      <p className="hh-card-sub">Pick a form to review it</p>
                    </div>
                    <span className="hh-count-inline">{approvedItems}/{totalItems} items approved</span>
                  </div>
                  <ul className="hh-formlist">
                    {FORMS.map(f => {
                      const fs = statusOf(f.id)
                      const submittedAt = hire.form_submitted_at?.[f.id] ?? null
                      return (
                        <li key={f.id}>
                          <button
                            type="button"
                            className={`hh-formlist-item${f.id === selectedForm ? ' selected' : ''}`}
                            aria-current={f.id === selectedForm ? 'true' : undefined}
                            onClick={() => selectTab('forms', f.id)}
                          >
                            <span className="hh-formlist-text">
                              <span className="hh-formlist-name">{HIRE_FORM_LABELS[f.id]}</span>
                              <span className="hh-formlist-date">
                                {fs === 'pending' ? 'Not yet submitted' : `Submitted ${timeAgo(submittedAt)}`}
                                {f.sensitive && fs !== 'pending' ? ', encrypted' : ''}
                              </span>
                            </span>
                            <StatusPill tone={FORM_STATUS[fs].tone}>{FORM_STATUS[fs].label}</StatusPill>
                          </button>
                        </li>
                      )
                    })}
                    {/* The fifth item: required documents. Opens the Uploaded documents card below. */}
                    <li>
                      <button
                        type="button"
                        className="hh-formlist-item"
                        aria-controls="hh-docs-card"
                        onClick={() => {
                          const el = document.getElementById('hh-docs-card')
                          el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          el?.focus({ preventScroll: true })
                        }}
                      >
                        <span className="hh-formlist-text">
                          <span className="hh-formlist-name">Documents</span>
                          <span className="hh-formlist-date">
                            {docsItem ? `${docsItem.approved_required} of ${docsItem.total_required} required approved` : 'Loading…'}
                          </span>
                        </span>
                        {docsItem && <StatusPill tone={FORM_STATUS[docsItem.status].tone}>{FORM_STATUS[docsItem.status].label}</StatusPill>}
                      </button>
                    </li>
                  </ul>
                  {clearanceAvailable && (
                    <div className="hh-card-foot left">
                      Security clearance is tracked in the{' '}
                      <button type="button" className="hh-linkbtn" onClick={() => openFromOverview('clearance')}>Clearance tab</button>.
                    </div>
                  )}
                </section>

                <section className="hh-card" aria-labelledby="hh-form-detail-title">
                  <div className="hh-card-head row">
                    <h2 id="hh-form-detail-title" className="hh-card-title">{HIRE_FORM_LABELS[selectedForm]}</h2>
                    <StatusPill tone={FORM_STATUS[selStatus].tone}>{FORM_STATUS[selStatus].label}</StatusPill>
                  </div>

                  {selStatus === 'pending' ? (
                    <div className="hh-empty">The new hire has not submitted this form yet.</div>
                  ) : (
                    <>
                      {selStatus === 'flagged' && flagReasons[selectedForm] && (
                        <div className="hh-flag-note" role="note">
                          <strong>Flagged:</strong> {flagReasons[selectedForm]}. Waiting for the new hire to resubmit.
                        </div>
                      )}

                      <dl className="hh-fields">
                        {selectedForm === 'personal' && (<>
                          <dt>Full name</dt><dd>{hire.name}</dd>
                          <dt>Email</dt><dd>{hire.email}</dd>
                          <dt>Date of birth</dt>
                          {hire.has_date_of_birth
                            ? <dd className={`hh-secret${revealed.personal ? ' shown' : ''}`}>{revealed.personal ? (formatDob(revealed.personal.date_of_birth) ?? 'Not provided') : <><span aria-hidden="true">••••••••</span><span className="hh-sr-only">Hidden</span></>}</dd>
                            : <dd className="hh-muted">Not on file</dd>}
                          <dt>Phone</dt><dd>{hire.phone}</dd>
                          <dt>Work phone setup</dt>
                          <dd className={hire.phone_choice ? '' : 'hh-muted'}>
                            {hire.phone_choice === 'work'
                              ? `${PHONE_CHOICE_LABELS.work} · ${hire.work_phone_platform ? WORK_PHONE_PLATFORM_LABELS[hire.work_phone_platform] : 'platform not chosen'}`
                              : hire.phone_choice === 'personal'
                                ? PHONE_CHOICE_LABELS.personal
                                : 'Not answered (submitted before this question was added)'}
                          </dd>
                          {hire.phone_choice === 'personal' && (<>
                            <dt>Personal phone</dt>
                            {hire.has_personal_phone
                              ? <dd className={`hh-secret${revealed.personal ? ' shown' : ''}`}>{revealed.personal ? (revealed.personal.personal_phone ?? 'Not provided') : <><span aria-hidden="true">••••••••</span><span className="hh-sr-only">Hidden</span></>}</dd>
                              : <dd className="hh-muted">Not on file</dd>}
                          </>)}
                          {(hire.has_date_of_birth || hire.has_personal_phone) && (<>
                            <dt className="hh-sr-only">Personal details</dt>
                            <dd className="hh-sensitive hh-reveal-row">
                              <span className="hh-sensitive-text hh-muted">
                                {revealed.personal
                                  ? `Shown for up to ${REVEAL_VISIBLE_SECONDS} seconds.`
                                  : hire.has_personal_phone ? 'Encrypted. One code shows the date of birth and personal phone.' : 'Encrypted.'}
                              </span>
                              {revealed.personal
                                ? <button type="button" className="hh-btn secondary" onClick={() => setRevealed(r => ({ ...r, personal: undefined }))}>Hide</button>
                                : <button type="button" className="hh-btn" onClick={() => setRevealGroup('personal')}>Reveal · code sent to your email</button>}
                            </dd>
                          </>)}
                          <dt>Address</dt><dd>{hire.address}</dd>
                          <dt>Emergency contact</dt><dd>{hire.emergency_contact}</dd>
                          <dt>Emergency phone</dt><dd>{hire.emergency_phone}</dd>
                        </>)}

                        {selectedForm === 'banking' && (<>
                          <dt>Bank</dt><dd>{hire.bank_name}</dd>
                          <dt>Account type</dt><dd>{hire.account_type}</dd>
                          {hire.has_banking ? (<>
                            <dt>Institution number</dt>
                            <dd className={`hh-secret${revealed.banking ? ' shown' : ''}`}>{revealed.banking ? revealed.banking.institution_number : <><span aria-hidden="true">•••</span><span className="hh-sr-only">Hidden</span></>}</dd>
                            <dt>Transit number</dt>
                            <dd className={`hh-secret${revealed.banking ? ' shown' : ''}`}>{revealed.banking ? revealed.banking.transit_number : <><span aria-hidden="true">•••••</span><span className="hh-sr-only">Hidden</span></>}</dd>
                            <dt>Account number</dt>
                            <dd className={`hh-secret${revealed.banking ? ' shown' : ''}`}>{revealed.banking ? revealed.banking.account_number : <><span aria-hidden="true">•••••••</span><span className="hh-sr-only">Hidden</span></>}</dd>
                            <dt className="hh-sr-only">Banking numbers</dt>
                            <dd className="hh-sensitive hh-reveal-row">
                              <span className="hh-sensitive-text hh-muted">
                                {revealed.banking ? `Shown for up to ${REVEAL_VISIBLE_SECONDS} seconds.` : 'Encrypted. One code shows all three numbers.'}
                              </span>
                              {revealed.banking
                                ? <button type="button" className="hh-btn secondary" onClick={() => setRevealed(r => ({ ...r, banking: undefined }))}>Hide</button>
                                : <button type="button" className="hh-btn" onClick={() => setRevealGroup('banking')}>Reveal · code sent to your email</button>}
                            </dd>
                          </>) : (<>
                            <dt>Account numbers</dt><dd className="hh-muted">Not on file</dd>
                          </>)}
                          {hire.has_void_cheque && (<>
                            <dt>Void cheque</dt>
                            <dd className="hh-sensitive">
                              <span className="hh-sensitive-text">On file</span>
                              <span className="hh-btn-row">
                                <button type="button" className="hh-btn" onClick={async () => {
                                  const r = await fetch(`/api/hr/hires/${hireId}/void-cheque`)
                                  if (r.ok) { const { url } = await r.json(); window.open(url, '_blank') }
                                  else showToast('Could not load void cheque')
                                }}>
                                  View
                                </button>
                                <button
                                  type="button"
                                  className="hh-btn"
                                  disabled={downloading === 'void-cheque'}
                                  onClick={() => handleDownload('void-cheque', `/api/hr/hires/${hireId}/void-cheque?download=1`)}
                                >
                                  {downloading === 'void-cheque' ? 'Downloading…' : 'Download'}
                                </button>
                              </span>
                            </dd>
                          </>)}
                        </>)}

                        {selectedForm === 'sin' && (<>
                          <dt>Social Insurance Number</dt>
                          {hire.has_sin ? (
                            <dd className="hh-sensitive">
                              <span className={`hh-secret${revealed.sin ? ' shown' : ''}`}>
                                {revealed.sin
                                  ? `${revealed.sin.slice(0,3)} ${revealed.sin.slice(3,6)} ${revealed.sin.slice(6)}`
                                  : <><span aria-hidden="true">••• ••• •••</span><span className="hh-sr-only">Hidden</span></>}
                              </span>
                              {revealed.sin
                                ? <button type="button" className="hh-btn secondary" onClick={() => setRevealed(r => ({ ...r, sin: undefined }))}>Hide</button>
                                : <button type="button" className="hh-btn" onClick={() => setRevealGroup('sin')}>Reveal · code sent to your email</button>}
                            </dd>
                          ) : <dd className="hh-muted">Not on file</dd>}
                        </>)}

                        {selectedForm === 'policy' && (<>
                          <dt>Signed by</dt><dd>{hire.name}</dd>
                          <dt>Date signed</dt><dd>{hire.start_date}</dd>
                          <dt>Policies acknowledged</dt>
                          <dd>Code of Conduct · Health &amp; Safety · Privacy · IT Use · Harassment Policy · Social Media · Conflicts of Interest</dd>
                        </>)}
                      </dl>

                      {selStatus !== 'approved' && (
                        <div className="hh-card-foot left">
                          {(selStatus === 'review' || selStatus === 'flagged') && (
                            <button type="button" className="hh-btn approve" onClick={() => handleFormApprove(selectedForm)}>Approve</button>
                          )}
                          {selStatus !== 'flagged' && (
                            <button type="button" className="hh-btn danger" onClick={() => openFlagModal(selectedForm)}>Flag for revision</button>
                          )}
                        </div>
                      )}
                      {selMeta.sensitive && <span className="hh-sr-only">This form contains encrypted fields.</span>}
                    </>
                  )}
                </section>
              </div>

              {/* Documents */}
              <section className="hh-card" id="hh-docs-card" tabIndex={-1} aria-labelledby="hh-docs-title">
                <div className="hh-card-head row">
                  <div>
                    <h2 id="hh-docs-title" className="hh-card-title">Uploaded documents</h2>
                    <p className="hh-card-sub">Approve or reject each one. Private storage; links expire after 60 seconds.</p>
                  </div>
                  {hireDocuments && (
                    <span className="hh-count-inline">
                      {hireDocuments.filter(d => d.form_status === 'approved').length}/{hireDocuments.length} approved
                    </span>
                  )}
                </div>

                {hireDocuments === null ? (
                  <div className="hh-card-body" aria-busy="true" aria-label="Loading documents"><div className="hh-skeleton" /><div className="hh-skeleton" /></div>
                ) : hireDocuments.length === 0 ? (
                  <div className="hh-empty">No documents uploaded yet.</div>
                ) : (
                  <div>
                    {DOC_SECTION_MAP.map(section => {
                      const sectionDocs = hireDocuments.filter(d => section.types.includes(d.document_type))
                      if (sectionDocs.length === 0) return null
                      return (
                        <div key={section.title}>
                          <div className="hh-group-label">{section.title}</div>
                          {sectionDocs.map(doc => {
                            const ds = DOC_STATUS[doc.form_status] ?? DOC_STATUS.pending
                            return (
                              <div key={doc.id} className="hh-doc">
                                <div className="hh-doc-text">
                                  <div className="hh-doc-name">{doc.document_label}</div>
                                  <div className="hh-doc-meta">
                                    {doc.file_name}
                                    {doc.file_size ? ` · ${formatBytes(doc.file_size)}` : ''}
                                    {' · '}Uploaded {new Date(doc.uploaded_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    {doc.expiry_date && (
                                      <>
                                        {' · '}Expires {doc.expiry_date}
                                        {isExpiringSoon(doc.expiry_date) && <strong className="hh-warn-text"> · Expiring soon</strong>}
                                      </>
                                    )}
                                  </div>
                                  {doc.form_status === 'rejected' && doc.flag_reason && (
                                    <div className="hh-flag-note small"><strong>Rejection reason:</strong> {doc.flag_reason}</div>
                                  )}
                                </div>
                                <StatusPill tone={ds.tone}>{ds.label}</StatusPill>
                                <div className="hh-btn-row">
                                  {(doc.form_status === 'approved' || doc.form_status === 'rejected' || doc.form_status === 'review') && (
                                    <>
                                      <button type="button" className="hh-btn" onClick={() => handleDocumentView(doc.id)}>View</button>
                                      <button
                                        type="button"
                                        className="hh-btn"
                                        disabled={downloading === doc.id}
                                        onClick={() => handleDownload(doc.id, `/api/hr/hires/${hireId}/documents/${doc.id}/view?download=1`)}
                                      >
                                        {downloading === doc.id ? 'Downloading…' : 'Download'}
                                      </button>
                                    </>
                                  )}
                                  {doc.form_status === 'review' && (
                                    <>
                                      <button type="button" className="hh-btn approve" onClick={() => handleDocumentApprove(doc.id)}>Approve</button>
                                      <button type="button" className="hh-btn danger" onClick={() => { setRejectDocModal({ documentId: doc.id }); setRejectDocReason('') }}>Reject</button>
                                    </>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </>
          ))}

          {/* ── EQUIPMENT ── */}
          {panel('equipment', stakeholderTasks === null ? (
            <div className="hh-card hh-skeleton-card" aria-busy="true" aria-label="Loading equipment">
              <div className="hh-skeleton" style={{ width: '40%' }} /><div className="hh-skeleton" /><div className="hh-skeleton" />
            </div>
          ) : (
            <>
              <div className="hrd-card">
                <div className="hrd-card-header">
                  <div className="hrd-card-icon amber">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="1.8" strokeLinecap="round">
                      <polyline points="9 11 12 14 22 4"/>
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                  </div>
                  <div>
                    <h2 className="hrd-card-title">Equipment Provisioning</h2>
                    <div className="hrd-card-sub">Check off items as they are issued to this new hire</div>
                  </div>
                  <div className="hrd-card-header-right hh-count-inline">{checkedCount}/{ALL_EQUIPMENT_ITEMS.length} issued</div>
                </div>
                <div className="hrd-equip-body">
                  <div className="hrd-equip-progress">
                    <div className="hrd-equip-bar-wrap">
                      <div className="hrd-equip-bar-fill" style={{ width:`${equipPct}%` }} />
                    </div>
                    <div className="hrd-equip-pct">{equipPct}%</div>
                  </div>
                  {/* Information only: no approval step, task or notification */}
                  {hire.phone_choice === 'work' && hire.work_phone_platform && (
                    <p className="hh-info-line" role="note">
                      <strong>Work phone requested:</strong> {WORK_PHONE_PLATFORM_LABELS[hire.work_phone_platform]}
                    </p>
                  )}
                  {EQUIPMENT_LIST.map(cat => (
                    <div key={cat.category} className="hrd-equip-category">
                      <div className="hrd-equip-category-label">{cat.category}</div>
                      <div className="hrd-equip-items">
                        {cat.items.map(item => {
                          const vehicleFlow    = item.id === 'vehicle' && !!vehicleStep
                          const itemTasks      = tasksByKey[item.id] ?? []
                          const confirmedTasks = itemTasks.filter(t => t.status === 'confirmed')
                          const pendingTasks   = itemTasks.filter(t => t.status === 'pending')
                          const isConfirmed    = vehicleFlow ? vehicleStep === 'complete' : itemTasks.length > 0 && pendingTasks.length === 0
                          const isPending      = !isConfirmed && (vehicleFlow || pendingTasks.length > 0)
                          const isChecked      = isConfirmed || (checkedItems[item.id] ?? false)

                          const allNames       = itemTasks.map(t => t.stakeholder_name).filter(Boolean).join(', ')
                          const confirmedNames = confirmedTasks.map(t => t.stakeholder_name).filter(Boolean).join(', ')
                          const pendingNames   = pendingTasks.map(t => t.stakeholder_name).filter(Boolean).join(', ')

                          return (
                            <div
                              key={item.id}
                              className={`hrd-equip-item ${isChecked ? 'checked' : ''}${isConfirmed ? ' hh-confirmed' : ''}`}
                              onClick={isConfirmed ? undefined : () => setCheckedItems(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                            >
                              <div className="hrd-equip-checkbox">
                                {isChecked && (
                                  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                                    <polyline points="20 6 9 17 4 12"/>
                                  </svg>
                                )}
                              </div>
                              <div className="hrd-equip-item-label">{item.label}</div>
                              <div className="hrd-equip-item-note">
                                {vehicleFlow ? (
                                  isConfirmed
                                    ? <span className="hh-ok-text">✓ Complete: details, checked, insured</span>
                                    : <span className="hh-warn-text">{VEHICLE_STEP_LABELS[vehicleStep!]}</span>
                                ) : isConfirmed ? (
                                  <span className="hh-ok-text">✓ Confirmed{allNames ? ` by ${allNames}` : ''}</span>
                                ) : itemTasks.length > 1 && (confirmedTasks.length > 0 || isPending) ? (
                                  <span className="hh-warn-text">{confirmedTasks.length}/{itemTasks.length} confirmed — waiting on {pendingNames || allNames}</span>
                                ) : confirmedTasks.length > 0 ? (
                                  <span className="hh-warn-text">Confirmed by {confirmedNames} — awaiting {pendingNames}</span>
                                ) : isPending ? (
                                  <span className="hh-warn-text">Awaiting confirmation{allNames ? ` from ${allNames}` : ''}</span>
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
                      {localCheckedCount !== Object.values(savedItems).filter(Boolean).length
                        ? `${localCheckedCount - Object.values(savedItems).filter(Boolean).length > 0 ? '+' : ''}${localCheckedCount - Object.values(savedItems).filter(Boolean).length} unsaved changes`
                        : 'All changes saved'}
                    </div>
                    <button className="hrd-equip-save-btn" onClick={handleSaveEquipment}>
                      Save Provisioning Record
                    </button>
                  </div>
                </div>
              </div>

              {/* Stakeholder confirmations and completion notes */}
              <section className="hh-card" aria-labelledby="hh-stake-title">
                <div className="hh-card-head row">
                  <div>
                    <h2 id="hh-stake-title" className="hh-card-title">Stakeholder confirmations</h2>
                    <p className="hh-card-sub">Third-party confirmations for equipment and access items</p>
                  </div>
                  <span className="hh-count-inline">
                    {groupedTasks.filter(g => g.isComplete).length + (vehicleStep === 'complete' ? 1 : 0)}/{groupedTasks.length + (vehicleStep ? 1 : 0)} confirmed
                  </span>
                </div>

                {vehicleStep && <VehicleRequestRow hireId={hireId} step={vehicleStep} />}

                {groupedTasks.length === 0 && !vehicleStep ? (
                  <div className="hh-empty">No stakeholder tasks created yet. They are generated when equipment items are saved.</div>
                ) : (
                  <div>
                    {groupedTasks.map(group => {
                      const isMulti        = group.assignees.length > 1
                      const isExpanded     = expandedGroups[group.task_key] ?? false
                      const confirmedNames = group.assignees.filter(a => a.status === 'confirmed').map(a => a.name).join(', ')
                      const waitingNames   = group.assignees.filter(a => a.status !== 'confirmed').map(a => a.name).join(', ')
                      const singleAssignee = group.assignees[0]

                      return (
                        <div key={group.task_key} className="hh-stake">
                          <div className="hh-stake-row">
                            <div className="hh-doc-text">
                              <div className="hh-doc-name">{group.task_name}</div>
                              <div className="hh-doc-meta">
                                {isMulti ? (
                                  <>
                                    {confirmedNames && <span>Confirmed: {confirmedNames}</span>}
                                    {confirmedNames && waitingNames && ' · '}
                                    {waitingNames && <span>Waiting on: {waitingNames}</span>}
                                  </>
                                ) : (
                                  <>
                                    {singleAssignee?.name}
                                    {singleAssignee?.confirmed_at && (
                                      <> · Confirmed {new Date(singleAssignee.confirmed_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                                    )}
                                    {!singleAssignee?.confirmed_at && singleAssignee?.status === 'pending' && <> · Awaiting confirmation</>}
                                  </>
                                )}
                              </div>
                            </div>

                            <StatusPill tone={group.isComplete ? 'green' : 'amber'}>
                              {isMulti && !group.isComplete ? `${group.confirmedCount}/${group.totalCount} confirmed` : group.isComplete ? 'Confirmed' : 'Pending'}
                            </StatusPill>

                            {!isMulti && singleAssignee?.status === 'confirmed' && singleAssignee.has_note && (() => {
                              const noteRevealed = Object.prototype.hasOwnProperty.call(revealedNotes, singleAssignee.task_id)
                              const isFetching   = fetchingNote === singleAssignee.task_id
                              return (
                                <button
                                  type="button"
                                  className={`hh-btn${noteRevealed ? ' secondary' : ''}`}
                                  onClick={() => noteRevealed ? handleHideNote(singleAssignee.task_id) : handleViewNote(singleAssignee.task_id)}
                                  disabled={isFetching}
                                >
                                  {isFetching ? 'Loading…' : noteRevealed ? 'Hide' : 'View note'}
                                </button>
                              )
                            })()}

                            {isMulti && (
                              <button
                                type="button"
                                className="hh-btn secondary icon"
                                onClick={() => setExpandedGroups(prev => ({ ...prev, [group.task_key]: !isExpanded }))}
                                aria-expanded={isExpanded}
                                aria-label={isExpanded ? `Collapse ${group.task_name}` : `Expand ${group.task_name}`}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={isExpanded ? 'flip' : ''} aria-hidden="true">
                                  <polyline points="6 9 12 15 18 9"/>
                                </svg>
                              </button>
                            )}
                          </div>

                          {!isMulti && singleAssignee && Object.prototype.hasOwnProperty.call(revealedNotes, singleAssignee.task_id) && (
                            <div className="hh-note-reveal">
                              <div className="hh-note-reveal-head">
                                <span>Completion note</span>
                                <button type="button" className="hh-btn small" onClick={() => navigator.clipboard.writeText(revealedNotes[singleAssignee.task_id])}>Copy</button>
                              </div>
                              <div className="hh-note-reveal-text">{revealedNotes[singleAssignee.task_id]}</div>
                            </div>
                          )}

                          {isMulti && isExpanded && (
                            <div className="hh-stake-assignees">
                              {group.assignees.map(assignee => {
                                const noteRevealed = Object.prototype.hasOwnProperty.call(revealedNotes, assignee.task_id)
                                const isFetching   = fetchingNote === assignee.task_id
                                return (
                                  <div key={assignee.task_id}>
                                    <div className="hh-stake-row sub">
                                      <div className="hh-doc-text">
                                        <span className="hh-doc-name small">{assignee.name}</span>
                                        <span className="hh-doc-meta inline">
                                          {assignee.confirmed_at
                                            ? ` · Confirmed ${new Date(assignee.confirmed_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}`
                                            : ' · Awaiting'}
                                        </span>
                                      </div>
                                      <StatusPill tone={assignee.status === 'confirmed' ? 'green' : 'amber'}>
                                        {assignee.status === 'confirmed' ? 'Confirmed' : 'Pending'}
                                      </StatusPill>
                                      {assignee.status === 'confirmed' && assignee.has_note && (
                                        <button
                                          type="button"
                                          className={`hh-btn${noteRevealed ? ' secondary' : ''}`}
                                          onClick={() => noteRevealed ? handleHideNote(assignee.task_id) : handleViewNote(assignee.task_id)}
                                          disabled={isFetching}
                                        >
                                          {isFetching ? 'Loading…' : noteRevealed ? 'Hide' : 'View note'}
                                        </button>
                                      )}
                                    </div>
                                    {noteRevealed && (
                                      <div className="hh-note-reveal indent">
                                        <div className="hh-note-reveal-head">
                                          <span>Completion note</span>
                                          <button type="button" className="hh-btn small" onClick={() => navigator.clipboard.writeText(revealedNotes[assignee.task_id])}>Copy</button>
                                        </div>
                                        <div className="hh-note-reveal-text">{revealedNotes[assignee.task_id]}</div>
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </>
          ))}

          {/* ── PLAN & PROJECT ── */}
          {panel('plan', (
            <div className="hh-two">
              <ManagerPlanCard
                hireId={hireId}
                alwaysExpanded
                onManagerChanged={m => {
                  setHire(h => h ? { ...h, reporting_manager_name: m.name, reporting_manager_email: m.email } : h)
                  addAuditLocal('navy', '<strong>HR</strong> changed the reporting manager for the onboarding plan')
                  refreshOverview()
                }}
              />
              <div>
                <PmRequestCard
                  key={pmVersion}
                  hireId={hireId}
                  onToast={toastAndRefresh}
                  onSetRegion={() => { selectTab('overview'); setEditingRegion(true) }}
                />
                {overview && !overview.areas.some(a => a.key === 'pm' && a.value !== 'Not needed') && (
                  <section className="hh-card">
                    <div className="hh-card-head"><h2 className="hh-card-title">Project management</h2></div>
                    <div className="hh-empty">Only needed when the manager&apos;s plan asks for a PSPC &amp; RCMP clearance.</div>
                  </section>
                )}
              </div>
            </div>
          ))}

          {/* ── CLEARANCE ── */}
          {clearanceAvailable && panel('clearance', !clearance ? (
            <div className="hh-card hh-skeleton-card" aria-busy="true" aria-label="Loading clearance">
              <div className="hh-skeleton" style={{ width: '40%' }} /><div className="hh-skeleton" /><div className="hh-skeleton" />
            </div>
          ) : !clearance.required ? (
            <section className="hh-card"><div className="hh-empty">This hire does not need a security clearance.</div></section>
          ) : (
            <>
              <ClearanceTrackerCard
                hireId={hireId}
                view={clearance}
                onRefresh={() => { setClearanceVersion(v => v + 1); refreshOverview() }}
                onToast={showToast}
              />
              <div className="hrd-card">
                <div className="hrd-card-header">
                  <div>
                    <h2 className="hrd-card-title">Clearance form review</h2>
                    <div className="hrd-card-sub">Approve or reject each form. Tracked separately from the four forms.</div>
                  </div>
                </div>
                <ClearanceReviewRow
                  hireId={hireId}
                  view={clearance}
                  onReviewed={() => { setClearanceVersion(v => v + 1); refreshOverview() }}
                  onToast={showToast}
                />
              </div>
            </>
          ))}

          {/* ── NOTES & ACTIVITY ── */}
          {panel('activity', (
            <div className="hh-two">
              <section className="hh-card" aria-labelledby="hh-notes-title">
                <div className="hh-card-head">
                  <h2 id="hh-notes-title" className="hh-card-title">HR notes</h2>
                  <p className="hh-card-sub">Not visible to the new hire</p>
                </div>
                <div className="hh-card-body">
                  <form onSubmit={handleSaveNote} className="hh-note-form">
                    <label htmlFor="hh-note-input" className="hh-label">Add an internal note</label>
                    <textarea id="hh-note-input" className="hh-textarea" rows={3} value={noteText} onChange={e => setNoteText(e.target.value)} />
                    <button type="submit" className="hh-btn primary">Save note</button>
                  </form>
                  {savedNotes.length === 0 ? (
                    <div className="hh-empty flush">No notes yet.</div>
                  ) : (
                    <ul className="hh-notes">
                      {savedNotes.map((note, i) => (
                        <li key={note.id ?? i} className="hh-note">
                          <div className="hh-note-text">{note.note_text}</div>
                          <div className="hh-note-meta">{note.creator_name ?? 'HR'} · {new Date(note.created_at).toLocaleString('en-CA', { dateStyle:'medium', timeStyle:'short' })}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <AuditLogCard hireId={hireId} refreshKey={overviewVersion} localEntries={localAudit} />
            </div>
          ))}
        </div>
      </div>

      {revealGroup && (
        <RevealModal
          key={`${hireId}-${revealGroup}`}
          hireId={hireId}
          group={revealGroup}
          onClose={() => setRevealGroup(null)}
          onRevealed={onRevealed}
        />
      )}

      {/* ── FLAG REASON MODAL (unchanged) ── */}
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
              <button type="button" className="hh-btn secondary" onClick={() => setFlagModal(null)}>
                Cancel
              </button>
              <button type="button" className="hh-btn danger" onClick={submitFlagModal} disabled={flagReasonInput.trim().length < 10}>
                Submit Flag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REJECT DOCUMENT MODAL (unchanged) ── */}
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
              <button type="button" className="hh-btn secondary" onClick={() => { setRejectDocModal(null); setRejectDocReason('') }}>
                Cancel
              </button>
              <button type="button" className="hh-btn danger" onClick={submitDocumentReject} disabled={rejectDocReason.trim().length < 10}>
                Reject Document
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="hr-toast" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width:'15px', height:'15px', flexShrink:0 }}>
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          {toast}
        </div>
      )}

    </div>
  )
}
