'use client'

import Image from 'next/image'
import { useRouter, notFound } from 'next/navigation'
import { useEffect, useState, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import { timeAgo } from '@/lib/time-ago'

const TEAL = '#0F4C4A'
const TEAL_LIGHT = 'rgba(15,76,74,0.08)'
const TEAL_BORDER = 'rgba(15,76,74,0.2)'

type FormStatus = 'pending' | 'review' | 'approved' | 'flagged'
type DocStatus  = 'pending' | 'review' | 'approved' | 'rejected'

// Encrypted-at-rest fields are null when server-side decryption fails
type PersonalData = {
  first_name: string; last_name: string; date_of_birth: string | null
  phone: string | null; personal_email: string
  street: string | null; city: string | null; province: string; postal_code: string | null
  emergency_name: string | null; emergency_relationship: string; emergency_phone: string | null
  form_status: FormStatus; flag_reason: string | null; submitted_at: string | null
}

type BankingData = {
  bank_name: string; account_type: string; has_void_cheque: boolean
  institution_number: string; transit_number: string; account_number: string
  form_status: FormStatus; flag_reason: string | null; submitted_at: string | null
}

type SinData = {
  sin: string | null; form_status: FormStatus; flag_reason: string | null; submitted_at: string | null
}

type DocumentData = {
  id: string; document_type: string; document_label: string
  file_name: string
  form_status: DocStatus; flag_reason: string | null; uploaded_at: string
}

type HireDetail = {
  id: string; full_name: string; preferred_name: string | null
  position: string | null; start_date: string | null; status: string
  entered_payroll_queue_at: string | null
  employee_id: string | null; payroll_completed_at: string | null
  personal: PersonalData | null
  banking: BankingData | null
  sin: SinData | null
  policy_signed: boolean; policy_signed_at: string | null
  documents: DocumentData[]
}

function StatusBadge({ status }: { status: FormStatus | DocStatus | string }) {
  const map: Record<string, { label: string; color: string; bg: string; border: string }> = {
    approved: { label: 'Approved',       color: '#0D5C46', bg: 'rgba(13,92,70,0.1)',    border: 'rgba(13,92,70,0.2)' },
    flagged:  { label: 'Flagged',        color: '#C0392B', bg: 'rgba(192,57,43,0.1)',  border: 'rgba(192,57,43,0.2)' },
    rejected: { label: 'Rejected',       color: '#C0392B', bg: 'rgba(192,57,43,0.1)',  border: 'rgba(192,57,43,0.2)' },
    review:   { label: 'Under Review',   color: '#C8920A', bg: 'rgba(200,146,10,0.1)', border: 'rgba(200,146,10,0.25)' },
    pending:  { label: 'Pending',        color: '#888780', bg: 'rgba(0,0,0,0.05)',      border: 'rgba(0,0,0,0.1)' },
  }
  const style = map[status] ?? map.pending
  return (
    <span style={{
      fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '100px',
      color: style.color, background: style.bg, border: `1px solid ${style.border}`,
    }}>
      {style.label}
    </span>
  )
}

function SectionCard({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{
      background: '#fff', borderRadius: '14px',
      border: '1px solid rgba(0,0,0,0.07)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
      marginBottom: '1.25rem', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 1.25rem', borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '14px', color: '#1A1916' }}>{title}</div>
          {subtitle && <div style={{ fontSize: '11px', color: '#888780', marginTop: '1px' }}>{subtitle}</div>}
        </div>
        {action && <div>{action}</div>}
      </div>
      <div style={{ padding: '1.25rem' }}>{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '14px', color: '#1A1916' }}>{value || '—'}</div>
    </div>
  )
}

function FlagModal({
  formLabel, onConfirm, onCancel,
}: { formLabel: string; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)' }}>
      <div style={{ background: '#fff', borderRadius: '16px', padding: '1.5rem', width: '100%', maxWidth: '460px', margin: '1rem', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight: 700, fontSize: '16px', color: '#1A1916', marginBottom: '8px' }}>Flag {formLabel}</div>
        <div style={{ fontSize: '13px', color: '#888780', marginBottom: '16px' }}>Provide a reason so the employee knows what to correct.</div>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="Describe what needs to be corrected…"
          rows={4}
          style={{
            width: '100%', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.15)',
            padding: '10px 12px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid rgba(0,0,0,0.15)', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '13px', fontFamily: 'inherit', fontWeight: 500 }}>Cancel</button>
          <button
            onClick={() => reason.trim() && onConfirm(reason.trim())}
            disabled={!reason.trim()}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: 'none',
              background: reason.trim() ? '#C0392B' : '#ccc', color: '#fff',
              cursor: reason.trim() ? 'pointer' : 'default',
              fontSize: '13px', fontFamily: 'inherit', fontWeight: 600,
            }}
          >
            Flag
          </button>
        </div>
      </div>
    </div>
  )
}

function ApproveRejectButtons({
  formId, hireId, currentStatus,
  onApprove, onFlag, saving,
}: {
  formId: string; hireId: string; currentStatus: string
  onApprove: () => void; onFlag: () => void; saving: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      {currentStatus !== 'approved' && (
        <button
          onClick={onApprove}
          disabled={saving}
          style={{
            padding: '6px 14px', borderRadius: '8px', border: `1px solid ${TEAL}`,
            background: TEAL, color: '#fff', cursor: saving ? 'default' : 'pointer',
            fontSize: '12px', fontWeight: 600, fontFamily: 'inherit', opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Approve'}
        </button>
      )}
      {currentStatus !== 'flagged' && (
        <button
          onClick={onFlag}
          disabled={saving}
          style={{
            padding: '6px 14px', borderRadius: '8px', border: '1px solid rgba(192,57,43,0.4)',
            background: 'rgba(192,57,43,0.06)', color: '#C0392B',
            cursor: saving ? 'default' : 'pointer',
            fontSize: '12px', fontWeight: 600, fontFamily: 'inherit', opacity: saving ? 0.6 : 1,
          }}
        >
          Flag
        </button>
      )}
    </div>
  )
}

function RevealField({ label, value }: { label: string; value: string | null | undefined }) {
  const [revealed, setRevealed] = useState(false)
  if (!value) return <Field label={label} value="—" />
  return (
    <div style={{ marginBottom: '10px' }}>
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#888780', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ fontSize: '14px', color: '#1A1916', fontFamily: revealed ? 'monospace' : 'inherit' }}>
          {revealed ? value : '•'.repeat(Math.min(value.length, 9))}
        </div>
        <button
          onClick={() => setRevealed(r => !r)}
          style={{
            fontSize: '11px', fontWeight: 600, color: TEAL, background: TEAL_LIGHT,
            border: `1px solid ${TEAL_BORDER}`, borderRadius: '5px', padding: '2px 8px',
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {revealed ? 'Hide' : 'Reveal'}
        </button>
      </div>
    </div>
  )
}

export default function PayrollNewHireDetail({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter()
  const { id } = use(params)

  const [detail, setDetail]         = useState<HireDetail | null>(null)
  const [loading, setLoading]       = useState(true)
  const [notFoundFlag, setNotFound] = useState(false)
  const [saving, setSaving]         = useState<string | null>(null)
  const [viewingDoc, setViewingDoc] = useState<string | null>(null)
  const [flagTarget, setFlagTarget] = useState<{ formId: string; label: string } | null>(null)
  const [employeeIdInput, setEmployeeIdInput] = useState('')
  const [assigningSaving, setAssigningSaving] = useState(false)
  const [assignError, setAssignError]         = useState('')
  const [displayName, setDisplayName]         = useState('')
  const [toast, setToast]                     = useState('')
  const [downloading, setDownloading]         = useState<string | null>(null)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase.from('profiles').select('full_name, preferred_name').eq('id', user.id).single()
      if (data) setDisplayName(data.preferred_name ?? data.full_name ?? '')
    }).catch(() => {})
  }, [])

  useEffect(() => {
    fetch(`/api/payroll/hires/${id}`)
      .then(r => {
        if (r.status === 404) { setNotFound(true); return null }
        return r.ok ? r.json() : null
      })
      .then(d => { if (d) setDetail(d.detail) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function approveForm(formId: string) {
    setSaving(formId)
    const res = await fetch(`/api/payroll/hires/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formId, status: 'approved' }),
    })
    if (res.ok) {
      const d = await fetch(`/api/payroll/hires/${id}`)
      if (d.ok) { const j = await d.json(); setDetail(j.detail) }
    }
    setSaving(null)
  }

  async function flagForm(formId: string, reason: string) {
    setSaving(formId)
    setFlagTarget(null)
    const res = await fetch(`/api/payroll/hires/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formId, status: 'flagged', reason }),
    })
    if (res.ok) {
      const d = await fetch(`/api/payroll/hires/${id}`)
      if (d.ok) { const j = await d.json(); setDetail(j.detail) }
    }
    setSaving(null)
  }

  async function approveDoc(documentId: string) {
    setSaving(`doc-${documentId}`)
    const res = await fetch(`/api/payroll/hires/${id}/documents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, action: 'approve' }),
    })
    if (res.ok) {
      const d = await fetch(`/api/payroll/hires/${id}`)
      if (d.ok) { const j = await d.json(); setDetail(j.detail) }
    }
    setSaving(null)
  }

  async function rejectDoc(documentId: string, reason: string) {
    setSaving(`doc-${documentId}`)
    setFlagTarget(null)
    const res = await fetch(`/api/payroll/hires/${id}/documents`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentId, action: 'reject', reason }),
    })
    if (res.ok) {
      const d = await fetch(`/api/payroll/hires/${id}`)
      if (d.ok) { const j = await d.json(); setDetail(j.detail) }
    }
    setSaving(null)
  }

  async function viewDoc(documentId: string) {
    setViewingDoc(documentId)
    try {
      const res = await fetch(`/api/payroll/hires/${id}/documents/${documentId}/view`)
      if (!res.ok) { showToast('Could not load document'); return }
      const { url } = await res.json()
      window.open(url, '_blank')
    } catch {
      showToast('Could not load document')
    } finally {
      setViewingDoc(null)
    }
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

  async function handleAssignEmployeeId() {
    if (!employeeIdInput.trim()) return
    setAssignError('')
    setAssigningSaving(true)
    const res = await fetch(`/api/payroll/hires/${id}/employee-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employeeId: employeeIdInput.trim() }),
    })
    if (res.ok) {
      const j = await res.json()
      setDetail(prev => prev ? { ...prev, employee_id: j.employeeId, payroll_completed_at: new Date().toISOString() } : prev)
      setEmployeeIdInput('')
    } else {
      const j = await res.json().catch(() => ({}))
      setAssignError(j.error ?? 'Failed to assign employee ID')
    }
    setAssigningSaving(false)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#F5F4F1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ color: '#888780', fontSize: '14px' }}>Loading…</div>
      </div>
    )
  }

  if (notFoundFlag || !detail) {
    notFound()
  }

  const hire = detail!
  const displayNameFull = hire.preferred_name ? `${hire.preferred_name} (${hire.full_name})` : hire.full_name
  const queueDays = hire.entered_payroll_queue_at
    ? Math.max(0, Math.floor((Date.now() - new Date(hire.entered_payroll_queue_at).getTime()) / 86_400_000))
    : null

  return (
    <div style={{ minHeight: '100vh', background: '#F5F4F1', fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {toast && (
        <div style={{
          position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
          background: '#1A1916', color: '#fff', borderRadius: '10px',
          padding: '10px 20px', fontSize: '13px', fontWeight: 500, zIndex: 2000,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        }}>
          {toast}
        </div>
      )}

      {flagTarget && (
        <FlagModal
          formLabel={flagTarget.label}
          onConfirm={reason => {
            if (flagTarget.formId.startsWith('doc-')) {
              rejectDoc(flagTarget.formId.replace('doc-', ''), reason)
            } else {
              flagForm(flagTarget.formId, reason)
            }
          }}
          onCancel={() => setFlagTarget(null)}
        />
      )}

      {/* ── NAV ── */}
      <nav style={{
        background: TEAL, borderBottom: '1px solid rgba(255,255,255,0.08)',
        padding: '0 1.5rem', height: '60px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Image src="/logo.png" alt="AEM" width={100} height={26} style={{ filter: 'brightness(0) invert(1)', opacity: 0.9 }} />
          <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.18)' }} />
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>
            Payroll Portal
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => router.push('/payroll/dashboard')}
            style={{
              fontSize: '12px', color: 'rgba(255,255,255,0.6)', background: 'none',
              border: '1px solid rgba(255,255,255,0.18)', borderRadius: '7px',
              padding: '5px 11px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
            }}
          >
            ← Dashboard
          </button>
          {displayName && (
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)', fontWeight: 500 }}>{displayName}</span>
          )}
          <button
            onClick={handleSignOut}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '5px 11px', borderRadius: '7px',
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.6)',
              cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', fontWeight: 500,
            }}
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div style={{
        background: `linear-gradient(135deg, ${TEAL} 0%, #0a3332 100%)`,
        padding: '2rem 1.5rem', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-40px', right: '-40px', width: '220px', height: '220px',
          borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none',
        }} />
        <div style={{ maxWidth: '1100px', margin: '0 auto', position: 'relative' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: '6px' }}>
            Payroll Review
          </div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#fff', margin: '0 0 4px', letterSpacing: '-0.01em' }}>
            {displayNameFull}
          </h1>
          <div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)' }}>
            {hire.position ?? 'Position not set'}
            {hire.start_date && ` · Start: ${new Date(hire.start_date).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}`}
            {queueDays !== null && ` · In queue ${queueDays === 0 ? 'today' : `${queueDays}d`}`}
          </div>
          {hire.employee_id && (
            <div style={{ marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.12)', borderRadius: '8px', padding: '4px 12px' }}>
              <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>Employee ID:</span>
              <span style={{ fontSize: '13px', color: '#fff', fontWeight: 700, fontFamily: 'monospace' }}>{hire.employee_id}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── BODY ── */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 340px', gap: '1.25rem' }}>

        {/* ── LEFT COLUMN ── */}
        <div>

          {/* Personal Information */}
          <SectionCard
            title="Personal Information"
            subtitle={`Submitted ${timeAgo(hire.personal?.submitted_at ?? null)}`}
            action={hire.personal && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <StatusBadge status={hire.personal.form_status} />
                <ApproveRejectButtons
                  formId="personal" hireId={id}
                  currentStatus={hire.personal.form_status}
                  onApprove={() => approveForm('personal')}
                  onFlag={() => setFlagTarget({ formId: 'personal', label: 'Personal Information' })}
                  saving={saving === 'personal'}
                />
              </div>
            )}
          >
            {!hire.personal ? (
              <div style={{ color: '#888780', fontSize: '13px' }}>Not submitted yet.</div>
            ) : (
              <>
                {hire.personal.flag_reason && (
                  <div style={{ background: 'rgba(231,76,60,0.08)', border: '1.5px solid rgba(231,76,60,0.3)', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: '#7A1B12' }}>
                    <strong>Flagged:</strong> {hire.personal.flag_reason}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1.5rem' }}>
                  <Field label="First Name"    value={hire.personal.first_name} />
                  <Field label="Last Name"     value={hire.personal.last_name} />
                  <Field label="Date of Birth" value={hire.personal.date_of_birth} />
                  <Field label="Phone"         value={hire.personal.phone} />
                  <Field label="Personal Email" value={hire.personal.personal_email} />
                </div>
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: '10px', paddingTop: '10px' }}>
                  <Field label="Address" value={[hire.personal.street, [hire.personal.city, hire.personal.province, hire.personal.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')} />
                </div>
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: '10px', paddingTop: '10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#888780', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Emergency Contact</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1.5rem' }}>
                    <Field label="Name"         value={hire.personal.emergency_name} />
                    <Field label="Relationship" value={hire.personal.emergency_relationship} />
                    <Field label="Phone"        value={hire.personal.emergency_phone} />
                  </div>
                </div>
              </>
            )}
          </SectionCard>

          {/* Banking & Direct Deposit */}
          <SectionCard
            title="Banking & Direct Deposit"
            subtitle={`Submitted ${timeAgo(hire.banking?.submitted_at ?? null)}`}
            action={hire.banking && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <StatusBadge status={hire.banking.form_status} />
                <ApproveRejectButtons
                  formId="banking" hireId={id}
                  currentStatus={hire.banking.form_status}
                  onApprove={() => approveForm('banking')}
                  onFlag={() => setFlagTarget({ formId: 'banking', label: 'Banking Information' })}
                  saving={saving === 'banking'}
                />
              </div>
            )}
          >
            {!hire.banking ? (
              <div style={{ color: '#888780', fontSize: '13px' }}>Not submitted yet.</div>
            ) : (
              <>
                {hire.banking.flag_reason && (
                  <div style={{ background: 'rgba(231,76,60,0.08)', border: '1.5px solid rgba(231,76,60,0.3)', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: '#7A1B12' }}>
                    <strong>Flagged:</strong> {hire.banking.flag_reason}
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1.5rem' }}>
                  <Field label="Bank Name"    value={hire.banking.bank_name} />
                  <Field label="Account Type" value={hire.banking.account_type} />
                </div>
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: '10px', paddingTop: '10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#888780', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Account Details</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1.5rem' }}>
                    <RevealField label="Institution #" value={hire.banking.institution_number} />
                    <RevealField label="Transit #"     value={hire.banking.transit_number} />
                    <RevealField label="Account #"     value={hire.banking.account_number} />
                  </div>
                </div>
                <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', marginTop: '10px', paddingTop: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 14, height: 14, color: '#888780' }}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <span style={{ fontSize: '13px', color: hire.banking.has_void_cheque ? '#1A1916' : '#888780' }}>
                        {hire.banking.has_void_cheque ? 'Void cheque on file' : 'No void cheque uploaded'}
                      </span>
                    </div>
                    {hire.banking.has_void_cheque && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={async () => {
                            const r = await fetch(`/api/payroll/hires/${id}/void-cheque`)
                            if (r.ok) { const { url } = await r.json(); window.open(url, '_blank') }
                            else showToast('Could not load void cheque')
                          }}
                          style={{
                            padding: '5px 12px', borderRadius: '7px',
                            border: `1px solid ${TEAL_BORDER}`, background: TEAL_LIGHT,
                            color: TEAL, cursor: 'pointer',
                            fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                          }}
                        >
                          View Void Cheque
                        </button>
                        <button
                          onClick={() => handleDownload('void-cheque', `/api/payroll/hires/${id}/void-cheque?download=1`)}
                          disabled={downloading === 'void-cheque'}
                          style={{
                            padding: '5px 12px', borderRadius: '7px',
                            border: `1px solid ${TEAL_BORDER}`, background: TEAL_LIGHT,
                            color: TEAL, cursor: downloading === 'void-cheque' ? 'default' : 'pointer',
                            fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                            opacity: downloading === 'void-cheque' ? 0.6 : 1,
                          }}
                        >
                          {downloading === 'void-cheque' ? 'Downloading…' : 'Download'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </SectionCard>

          {/* Social Insurance Number */}
          <SectionCard
            title="Social Insurance Number"
            subtitle={`Submitted ${timeAgo(hire.sin?.submitted_at ?? null)}`}
            action={hire.sin && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <StatusBadge status={hire.sin.form_status} />
                <ApproveRejectButtons
                  formId="sin" hireId={id}
                  currentStatus={hire.sin.form_status}
                  onApprove={() => approveForm('sin')}
                  onFlag={() => setFlagTarget({ formId: 'sin', label: 'Social Insurance Number' })}
                  saving={saving === 'sin'}
                />
              </div>
            )}
          >
            {!hire.sin ? (
              <div style={{ color: '#888780', fontSize: '13px' }}>Not submitted yet.</div>
            ) : (
              <>
                {hire.sin.flag_reason && (
                  <div style={{ background: 'rgba(231,76,60,0.08)', border: '1.5px solid rgba(231,76,60,0.3)', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', fontSize: '13px', color: '#7A1B12' }}>
                    <strong>Flagged:</strong> {hire.sin.flag_reason}
                  </div>
                )}
                <RevealField label="SIN" value={hire.sin.sin} />
              </>
            )}
          </SectionCard>

          {/* Tax & Deposit Documents */}
          <SectionCard title="Tax & Deposit Documents">
            {hire.documents.length === 0 ? (
              <div style={{ color: '#888780', fontSize: '13px' }}>No documents uploaded yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {hire.documents.map(doc => (
                  <div key={doc.id} style={{
                    border: '1px solid rgba(0,0,0,0.08)', borderRadius: '10px',
                    padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1A1916', marginBottom: '2px' }}>{doc.document_label}</div>
                      <div style={{ fontSize: '12px', color: '#888780' }}>
                        {doc.file_name} · Uploaded {new Date(doc.uploaded_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                      {doc.flag_reason && (
                        <div style={{ fontSize: '12px', color: '#C0392B', marginTop: '4px' }}>
                          <strong>Rejected:</strong> {doc.flag_reason}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <StatusBadge status={doc.form_status} />
                      <button
                        onClick={() => viewDoc(doc.id)}
                        disabled={viewingDoc === doc.id}
                        style={{
                          padding: '5px 12px', borderRadius: '7px',
                          border: `1px solid ${TEAL_BORDER}`, background: TEAL_LIGHT,
                          color: TEAL, cursor: viewingDoc === doc.id ? 'default' : 'pointer',
                          fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                          opacity: viewingDoc === doc.id ? 0.6 : 1,
                        }}
                      >
                        {viewingDoc === doc.id ? 'Loading…' : 'View'}
                      </button>
                      <button
                        onClick={() => handleDownload(doc.id, `/api/payroll/hires/${id}/documents/${doc.id}/view?download=1`)}
                        disabled={downloading === doc.id}
                        style={{
                          padding: '5px 12px', borderRadius: '7px',
                          border: `1px solid ${TEAL_BORDER}`, background: TEAL_LIGHT,
                          color: TEAL, cursor: downloading === doc.id ? 'default' : 'pointer',
                          fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                          opacity: downloading === doc.id ? 0.6 : 1,
                        }}
                      >
                        {downloading === doc.id ? 'Downloading…' : 'Download'}
                      </button>
                      {doc.form_status !== 'approved' && (
                        <button
                          onClick={() => approveDoc(doc.id)}
                          disabled={saving === `doc-${doc.id}`}
                          style={{
                            padding: '5px 12px', borderRadius: '7px', border: `1px solid ${TEAL}`,
                            background: TEAL, color: '#fff', cursor: 'pointer',
                            fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                            opacity: saving === `doc-${doc.id}` ? 0.6 : 1,
                          }}
                        >
                          Approve
                        </button>
                      )}
                      {doc.form_status !== 'rejected' && (
                        <button
                          onClick={() => setFlagTarget({ formId: `doc-${doc.id}`, label: doc.document_label })}
                          disabled={saving === `doc-${doc.id}`}
                          style={{
                            padding: '5px 12px', borderRadius: '7px',
                            border: '1px solid rgba(192,57,43,0.4)',
                            background: 'rgba(192,57,43,0.06)', color: '#C0392B',
                            cursor: 'pointer', fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                            opacity: saving === `doc-${doc.id}` ? 0.6 : 1,
                          }}
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

        </div>

        {/* ── RIGHT COLUMN ── */}
        <div>

          {/* Policy Acknowledgement */}
          <div style={{
            background: '#fff', borderRadius: '14px', border: '1px solid rgba(0,0,0,0.07)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)', marginBottom: '1.25rem', overflow: 'hidden',
          }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#1A1916' }}>Policy Acknowledgement</div>
            </div>
            <div style={{ padding: '1.25rem' }}>
              {hire.policy_signed ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#0D5C46' }}>Signed</span>
                  </div>
                  {hire.policy_signed_at && (
                    <div style={{ fontSize: '12px', color: '#888780' }}>
                      {new Date(hire.policy_signed_at).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: '13px', color: '#888780' }}>Not yet signed.</div>
              )}
            </div>
          </div>

          {/* Assign Employee ID */}
          <div style={{
            background: '#fff', borderRadius: '14px', border: `1px solid ${hire.employee_id ? 'rgba(13,92,70,0.2)' : TEAL_BORDER}`,
            boxShadow: '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden',
          }}>
            <div style={{
              padding: '1rem 1.25rem', borderBottom: '1px solid rgba(0,0,0,0.06)',
              background: hire.employee_id ? 'rgba(13,92,70,0.04)' : TEAL_LIGHT,
            }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#1A1916' }}>Employee ID</div>
            </div>
            <div style={{ padding: '1.25rem' }}>
              {hire.employee_id ? (
                <>
                  <div style={{ fontSize: '22px', fontWeight: 700, fontFamily: 'monospace', color: TEAL, marginBottom: '4px' }}>
                    {hire.employee_id}
                  </div>
                  <div style={{ fontSize: '12px', color: '#888780' }}>
                    Assigned {hire.payroll_completed_at ? new Date(hire.payroll_completed_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                  </div>
                  <div style={{ marginTop: '12px', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: '12px' }}>
                    <div style={{ fontSize: '12px', color: '#888780', marginBottom: '8px' }}>Reassign employee ID:</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        value={employeeIdInput}
                        onChange={e => setEmployeeIdInput(e.target.value)}
                        placeholder="New employee ID"
                        style={{
                          flex: 1, borderRadius: '8px', border: '1px solid rgba(0,0,0,0.15)',
                          padding: '8px 10px', fontSize: '13px', fontFamily: 'monospace', outline: 'none',
                        }}
                      />
                      <button
                        onClick={handleAssignEmployeeId}
                        disabled={!employeeIdInput.trim() || assigningSaving}
                        style={{
                          padding: '8px 14px', borderRadius: '8px', border: 'none',
                          background: employeeIdInput.trim() ? TEAL : '#ccc', color: '#fff',
                          cursor: employeeIdInput.trim() ? 'pointer' : 'default',
                          fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                        }}
                      >
                        Update
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '13px', color: '#888780', marginBottom: '14px' }}>
                    Assign an employee ID to mark payroll processing as complete.
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      value={employeeIdInput}
                      onChange={e => { setEmployeeIdInput(e.target.value); setAssignError('') }}
                      placeholder="e.g. EMP-1042"
                      style={{
                        flex: 1, borderRadius: '8px', border: `1px solid ${assignError ? 'rgba(192,57,43,0.5)' : 'rgba(0,0,0,0.15)'}`,
                        padding: '8px 10px', fontSize: '13px', fontFamily: 'monospace', outline: 'none',
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') handleAssignEmployeeId() }}
                    />
                    <button
                      onClick={handleAssignEmployeeId}
                      disabled={!employeeIdInput.trim() || assigningSaving}
                      style={{
                        padding: '8px 14px', borderRadius: '8px', border: 'none',
                        background: employeeIdInput.trim() && !assigningSaving ? TEAL : '#ccc',
                        color: '#fff', cursor: employeeIdInput.trim() ? 'pointer' : 'default',
                        fontSize: '12px', fontWeight: 600, fontFamily: 'inherit',
                      }}
                    >
                      {assigningSaving ? 'Saving…' : 'Assign'}
                    </button>
                  </div>
                  {assignError && <div style={{ fontSize: '12px', color: '#C0392B', marginTop: '6px' }}>{assignError}</div>}
                </>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
