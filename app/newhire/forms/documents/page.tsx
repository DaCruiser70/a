'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useRef, useState, useEffect, useCallback } from 'react'
import '../../../../styles/pages/form-pages.css'
import { createClient } from '@/lib/supabase/client'
import type { NewhireDocument } from '@/types'
import { FORMS_HOME } from '@/lib/routes'

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isExpiringSoon(dateStr: string | null): boolean {
  if (!dateStr) return false
  const diff = new Date(dateStr).getTime() - Date.now()
  return diff > 0 && diff < 90 * 24 * 60 * 60 * 1000
}

function getProvincialDesc(loc: string | null): string {
  if (!loc) return 'Provincial TD1 form for your province of residence'
  const l = loc.toLowerCase()
  if (l.includes('dartmouth') || l.includes('nova scotia') || l.includes(' ns')) return 'Nova Scotia TD1 Provincial form'
  if (l.includes('moncton') || l.includes('new brunswick') || l.includes(' nb')) return 'New Brunswick TD1 Provincial form'
  if (l.includes('oakville') || l.includes('ontario') || l.includes(' on')) return 'Ontario TD1 Provincial form'
  return 'Provincial TD1 form for your province of residence'
}

type UploadState = {
  file: File | null
  dragging: boolean
  uploading: boolean
  error: string
  expiryDate: string
}

type MultiForm = {
  open: boolean
  label: string
  expiry: string
  file: File | null
  dragging: boolean
  uploading: boolean
  error: string
}

const EMPTY_UPLOAD: UploadState = { file: null, dragging: false, uploading: false, error: '', expiryDate: '' }
const EMPTY_MULTI: MultiForm   = { open: false, label: '', expiry: '', file: null, dragging: false, uploading: false, error: '' }

const SINGLE_DOC_TYPES = [
  'td1_federal', 'td1_provincial', 'drivers_license',
  'alternative_id', 'proof_of_insurance', 'cpic_background_check', 'work_permit',
]

const TRADE_LICENSE_TYPES = [
  'Gas Fitter License', 'HVAC License', 'Electrician License',
  'Instrumentation License', 'Apprentice Card', 'Other Trade License',
]
const CERT_TYPES = [
  'WHMIS', 'Fall Protection', 'Confined Space Entry',
  'Aerial Work Platform', 'First Aid/CPR', 'H2S Alive', 'Other Safety Certification',
]

function validateFile(f: File): string | null {
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
  if (!allowed.includes(f.type) && !f.name.match(/\.(pdf|jpg|jpeg|png)$/i)) {
    return 'Unsupported file type. Please upload a PDF, JPG, or PNG.'
  }
  if (f.size > 10 * 1024 * 1024) return 'File is too large. Maximum size is 10 MB.'
  return null
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string | undefined }) {
  if (!status || status === 'pending') return (
    <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '100px', background: 'rgba(136,135,128,0.1)', color: '#888780', border: '1px solid rgba(136,135,128,0.2)', whiteSpace: 'nowrap' }}>
      Not Uploaded
    </span>
  )
  if (status === 'review') return (
    <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '100px', background: 'rgba(200,146,10,0.1)', color: '#C8920A', border: '1px solid rgba(200,146,10,0.25)', whiteSpace: 'nowrap' }}>
      Pending Review
    </span>
  )
  if (status === 'approved') return (
    <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '100px', background: 'rgba(13,92,70,0.1)', color: '#0D5C46', border: '1px solid rgba(13,92,70,0.2)', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 10, height: 10 }}><polyline points="20 6 9 17 4 12"/></svg>
      Approved
    </span>
  )
  return (
    <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 9px', borderRadius: '100px', background: 'rgba(231,76,60,0.1)', color: '#E74C3C', border: '1px solid rgba(231,76,60,0.2)', whiteSpace: 'nowrap' }}>
      Rejected
    </span>
  )
}

// ── Drop zone ─────────────────────────────────────────────────────────────────
function DropZone({
  state, onChange, inputId,
}: {
  state: { file: File | null; dragging: boolean; error: string }
  onChange: (patch: Partial<UploadState | MultiForm>) => void
  inputId: string
}) {
  const ref = useRef<HTMLInputElement>(null)

  function pick(f: File) {
    const err = validateFile(f)
    if (err) { onChange({ error: err, file: null }); return }
    onChange({ file: f, error: '' })
  }

  return (
    <div>
      {!state.file ? (
        <div
          className={`banking-upload-zone${state.dragging ? ' dragging' : ''}`}
          onDragOver={e => { e.preventDefault(); onChange({ dragging: true }) }}
          onDragLeave={() => onChange({ dragging: false })}
          onDrop={e => { e.preventDefault(); onChange({ dragging: false }); const f = e.dataTransfer.files[0]; if (f) pick(f) }}
          onClick={() => ref.current?.click()}
          style={{ padding: '2rem 1.5rem' }}
        >
          <input id={inputId} ref={ref} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }} />
          <div className="banking-upload-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div className="banking-upload-title">
            Drag and drop your file here or <span>click to browse</span>
          </div>
          <div className="banking-upload-sub">Supports PDF, JPG, PNG up to 10 MB</div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: '#F5F3EF', border: '1.5px solid #E2DED8', borderRadius: '12px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round" style={{ width: 20, height: 20, flexShrink: 0 }}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '13px', color: '#1a2e25', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.file.name}</div>
            <div style={{ fontSize: '11px', color: '#888780' }}>{formatBytes(state.file.size)}</div>
          </div>
          <button onClick={() => onChange({ file: null, error: '' })} style={{ fontSize: '12px', fontWeight: 600, color: '#C0392B', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', fontFamily: 'var(--font-sans)', flexShrink: 0 }}>
            Remove
          </button>
        </div>
      )}
      {state.error && (
        <div style={{ fontSize: '12px', color: '#C0392B', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 12, height: 12, flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          {state.error}
        </div>
      )}
    </div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHead({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: '0.75rem', borderBottom: '2px solid rgba(27,58,107,0.08)', marginBottom: '-0.25rem' }}>
      <div style={{ width: 28, height: 28, borderRadius: '8px', background: 'rgba(27,58,107,0.07)', border: '1px solid rgba(27,58,107,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1B3A6B', flexShrink: 0 }}>
        {icon}
      </div>
      <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '17px', fontWeight: 600, color: '#1a2e25', margin: 0 }}>{title}</h3>
    </div>
  )
}

// ── Single document card ──────────────────────────────────────────────────────
function DocCard({
  docType, docLabel, description, required, needsExpiry, extra,
  doc, uploadState, onUploadChange, onUpload,
}: {
  docType: string
  docLabel: string
  description: string
  required: boolean
  needsExpiry: boolean
  extra?: React.ReactNode
  doc: NewhireDocument | undefined
  uploadState: UploadState
  onUploadChange: (patch: Partial<UploadState>) => void
  onUpload: () => void
}) {
  const isApproved = doc?.form_status === 'approved'
  const isRejected = doc?.form_status === 'rejected'
  const isReview   = doc?.form_status === 'review'

  return (
    <div className="form-section-card">
      {/* Header */}
      <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'flex-start', gap: '12px', background: '#FAFAF8' }}>
        <div className="form-section-icon navy">
          <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
            <div className="form-section-heading">{docLabel}</div>
            {required
              ? <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '100px', background: 'rgba(200,146,10,0.1)', color: '#C8920A', border: '1px solid rgba(200,146,10,0.2)', letterSpacing: '0.04em' }}>REQUIRED</span>
              : <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '100px', background: 'rgba(136,135,128,0.1)', color: '#888780', border: '1px solid rgba(136,135,128,0.15)', letterSpacing: '0.04em' }}>OPTIONAL</span>
            }
          </div>
          <div className="form-section-heading-sub" style={{ lineHeight: 1.5 }}>{description}</div>
        </div>
        <StatusBadge status={doc?.form_status} />
      </div>

      {/* Body */}
      <div style={{ padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

        {/* Extra content (info boxes, checkboxes) */}
        {extra}

        {isApproved ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '1rem 1.25rem', background: 'rgba(13,92,70,0.05)', border: '1.5px solid rgba(13,92,70,0.2)', borderRadius: '12px' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="2.5" strokeLinecap="round" style={{ width: 20, height: 20, flexShrink: 0 }}>
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <div>
              <div style={{ fontWeight: 600, fontSize: '13px', color: '#0D5C46' }}>Document Approved</div>
              <div style={{ fontSize: '12px', color: '#5F5E5A', marginTop: '2px' }}>
                {doc?.file_name} · {doc?.file_size ? formatBytes(doc.file_size) : ''}
                {doc?.expiry_date && ` · Expires ${doc.expiry_date}`}
              </div>
            </div>
          </div>
        ) : (
          <>
            {isRejected && doc?.flag_reason && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 16px', background: 'rgba(231,76,60,0.06)', border: '1.5px solid rgba(231,76,60,0.25)', borderRadius: '12px' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#E74C3C" strokeWidth="2" strokeLinecap="round" style={{ width: 16, height: 16, flexShrink: 0, marginTop: 1 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '12px', color: '#C0392B', marginBottom: '3px' }}>Document Rejected — Action Required</div>
                  <div style={{ fontSize: '12px', color: '#7A1B12', lineHeight: 1.5 }}>{doc.flag_reason}</div>
                </div>
              </div>
            )}

            {isReview && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'rgba(200,146,10,0.05)', border: '1px solid rgba(200,146,10,0.2)', borderRadius: '10px' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="2" strokeLinecap="round" style={{ width: 15, height: 15, flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <div style={{ fontSize: '12px', color: '#856211' }}>
                  <strong>{doc.file_name}</strong> · {doc.file_size ? formatBytes(doc.file_size) : ''} — pending HR review. You can replace this file if needed.
                </div>
              </div>
            )}

            {needsExpiry && (
              <div className="form-field">
                <label className="form-label" htmlFor={`exp-${docType}`}>Expiry Date <span className="form-label-required">*</span></label>
                <input
                  id={`exp-${docType}`}
                  type="date"
                  className="form-input"
                  value={uploadState.expiryDate}
                  onChange={e => onUploadChange({ expiryDate: e.target.value })}
                  style={{ maxWidth: '220px' }}
                />
              </div>
            )}

            <DropZone
              state={uploadState}
              onChange={onUploadChange}
              inputId={`file-${docType}`}
            />

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              <button
                className="form-btn-primary"
                disabled={!uploadState.file || uploadState.uploading || (needsExpiry && !uploadState.expiryDate)}
                onClick={onUpload}
                style={{ opacity: uploadState.file && !uploadState.uploading && (!needsExpiry || uploadState.expiryDate) ? 1 : 0.45, cursor: uploadState.file && !uploadState.uploading && (!needsExpiry || uploadState.expiryDate) ? 'pointer' : 'not-allowed', fontSize: '12px', padding: '9px 20px' }}
              >
                {uploadState.uploading ? 'Uploading…' : 'Upload Document'}
                {!uploadState.uploading && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 13, height: 13 }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DocumentsPage() {
  const router = useRouter()

  const [documents, setDocuments]           = useState<NewhireDocument[]>([])
  const [userName, setUserName]             = useState('')
  const [userId, setUserId]                 = useState('')
  const [officeLocation, setOfficeLocation] = useState<string | null>(null)
  const [loading, setLoading]               = useState(true)
  const [noInsurance, setNoInsurance]       = useState(false)

  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>(
    () => Object.fromEntries(SINGLE_DOC_TYPES.map(t => [t, { ...EMPTY_UPLOAD }]))
  )
  const [tradeForm, setTradeForm] = useState<MultiForm>({ ...EMPTY_MULTI })
  const [certForm, setCertForm]   = useState<MultiForm>({ ...EMPTY_MULTI })

  const updateUpload = useCallback((docType: string, patch: Partial<UploadState>) => {
    setUploadStates(prev => ({ ...prev, [docType]: { ...prev[docType], ...patch } }))
  }, [])

  const getDoc = (type: string) => documents.find(d => d.document_type === type)
  const getMultiDocs = (type: string) => documents.filter(d => d.document_type === type)

  const loadDocuments = useCallback(async () => {
    const res = await fetch('/api/forms/documents')
    if (res.ok) {
      const data = await res.json()
      setDocuments(data.documents ?? [])
    }
  }, [])

  useEffect(() => {
    async function init() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      setUserId(user.id)

      const [{ data: profile }, docsRes] = await Promise.all([
        supabase.from('profiles').select('full_name, preferred_name, office_location').eq('id', user.id).single(),
        fetch('/api/forms/documents').then(r => r.ok ? r.json() : { documents: [] }),
      ])

      if (profile) {
        setUserName(profile.preferred_name ?? profile.full_name ?? '')
        setOfficeLocation(profile.office_location ?? null)
      }
      setDocuments(docsRes.documents ?? [])
      setLoading(false)
    }
    init().catch(() => setLoading(false))
  }, [router])

  async function handleUpload(docType: string, docLabel: string) {
    const state = uploadStates[docType]
    if (!state?.file || !userId) return
    updateUpload(docType, { uploading: true, error: '' })
    try {
      const supabase = createClient()
      const ext = state.file.name.split('.').pop() ?? 'bin'
      const filePath = `${userId}/${docType}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage.from('newhire-documents').upload(filePath, state.file)
      if (uploadErr) throw new Error(uploadErr.message)

      const res = await fetch('/api/forms/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_type:  docType,
          document_label: docLabel,
          file_path:      filePath,
          file_name:      state.file.name,
          file_size:      state.file.size,
          expiry_date:    state.expiryDate || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to save document')
      }
      await loadDocuments()
      updateUpload(docType, { ...EMPTY_UPLOAD })
    } catch (err) {
      updateUpload(docType, { uploading: false, error: err instanceof Error ? err.message : 'Upload failed. Please try again.' })
    }
  }

  async function handleMultiUpload(docType: string, formState: MultiForm, setForm: React.Dispatch<React.SetStateAction<MultiForm>>) {
    if (!formState.file || !formState.label || !userId) return
    setForm(f => ({ ...f, uploading: true, error: '' }))
    try {
      const supabase = createClient()
      const ext = formState.file.name.split('.').pop() ?? 'bin'
      const filePath = `${userId}/${docType}/${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage.from('newhire-documents').upload(filePath, formState.file)
      if (uploadErr) throw new Error(uploadErr.message)

      const res = await fetch('/api/forms/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_type:  docType,
          document_label: formState.label,
          file_path:      filePath,
          file_name:      formState.file.name,
          file_size:      formState.file.size,
          expiry_date:    formState.expiry || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Failed to save document')
      }
      await loadDocuments()
      setForm({ ...EMPTY_MULTI })
    } catch (err) {
      setForm(f => ({ ...f, uploading: false, error: err instanceof Error ? err.message : 'Upload failed.' }))
    }
  }

  async function handleDeleteDoc(documentId: string) {
    const res = await fetch(`/api/forms/documents/${documentId}`, { method: 'DELETE' })
    if (res.ok) await loadDocuments()
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const REQUIRED_TYPES = ['td1_federal', 'td1_provincial']
  const requiredDocs   = REQUIRED_TYPES.map(t => getDoc(t))
  const requiredCount  = requiredDocs.filter(d => d && d.form_status !== 'pending').length
  const anyRejected    = documents.some(d => d.form_status === 'rejected')
  const allApproved    = requiredDocs.every(d => d?.form_status === 'approved')
  const allUploaded    = requiredDocs.every(d => !!d)

  const summaryStatus = anyRejected ? 'rejected'
    : allApproved ? 'approved'
    : allUploaded ? 'review'
    : 'pending'

  return (
    <div className="form-page">

      {/* ── NAV ── */}
      <nav className="form-page-nav">
        <div className="form-page-nav-left">
          <Image src="/logo.png" alt="AEM" width={120} height={32} className="form-page-nav-logo" />
          <div className="form-page-nav-div" />
          <span className="form-page-nav-label">Employee Onboarding Portal</span>
        </div>
        <div className="form-page-nav-right">
          <div className="form-page-nav-user">
            <div className="form-page-nav-avatar">{loading ? '…' : getInitials(userName)}</div>
            {userName && <span className="form-page-nav-name">{userName}</span>}
          </div>
        </div>
      </nav>

      {/* ── HEADER ── */}
      <div className="form-page-header">
        <div className="form-page-header-orb" />
        <div className="form-page-header-inner">
          <button className="form-page-back" onClick={() => router.push(FORMS_HOME)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
            Back to checklist
          </button>
          <div className="form-page-step-tag">Step 5 of 5</div>
          <h1 className="form-page-title">Your Documents</h1>
          <p className="form-page-sub">
            Upload the required documents below. All files are encrypted and stored securely — only authorized HR staff can access them.
          </p>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '1rem', padding: '5px 13px', borderRadius: '100px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', fontSize: '11px', color: 'rgba(255,255,255,0.65)', fontWeight: 600 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 12, height: 12 }}>
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            AES-256 Encrypted Storage
          </div>
        </div>
      </div>

      {/* ── BODY ── */}
      <div className="form-page-body">

        {/* ── Tax Forms ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <SectionHead title="Tax Forms" icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ width: 14, height: 14 }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
          } />

          <DocCard
            docType="td1_federal"
            docLabel="TD1 Federal Tax Form"
            description="Download the TD1 Federal form from the CRA website, complete it with your signature, and upload it here. This is required for payroll tax deductions."
            required={true}
            needsExpiry={false}
            doc={getDoc('td1_federal')}
            uploadState={uploadStates['td1_federal']}
            onUploadChange={p => updateUpload('td1_federal', p)}
            onUpload={() => handleUpload('td1_federal', 'TD1 Federal Tax Form')}
          />

          <DocCard
            docType="td1_provincial"
            docLabel="TD1 Provincial Tax Form"
            description={`${getProvincialDesc(officeLocation)}. Complete and sign the form for your province of employment and upload it here. Required for payroll tax deductions.`}
            required={true}
            needsExpiry={false}
            doc={getDoc('td1_provincial')}
            uploadState={uploadStates['td1_provincial']}
            onUploadChange={p => updateUpload('td1_provincial', p)}
            onUpload={() => handleUpload('td1_provincial', "TD1 Provincial Tax Form")}
          />
        </div>

        {/* ── Identity & Insurance ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <SectionHead title="Identity & Insurance" icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ width: 14, height: 14 }}>
              <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
            </svg>
          } />

          <DocCard
            docType="drivers_license"
            docLabel="Driver's License"
            description="Required if you will be driving a company vehicle. Also accepted as primary ID for PSPC and RCMP security clearances."
            required={false}
            needsExpiry={true}
            doc={getDoc('drivers_license')}
            uploadState={uploadStates['drivers_license']}
            onUploadChange={p => updateUpload('drivers_license', p)}
            onUpload={() => handleUpload('drivers_license', "Driver's License")}
          />

          <DocCard
            docType="alternative_id"
            docLabel="Alternative ID"
            description="If you do not have a driver's license, please upload a passport or other government-issued photo ID. Required for security clearance purposes."
            required={false}
            needsExpiry={false}
            doc={getDoc('alternative_id')}
            uploadState={uploadStates['alternative_id']}
            onUploadChange={p => updateUpload('alternative_id', p)}
            onUpload={() => handleUpload('alternative_id', 'Alternative ID')}
          />

          <DocCard
            docType="proof_of_insurance"
            docLabel="Proof of Insurance"
            description="Required if you will be driving a company vehicle. Upload your current auto insurance certificate."
            required={false}
            needsExpiry={true}
            extra={
              !getDoc('proof_of_insurance') || getDoc('proof_of_insurance')?.form_status !== 'approved' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#4A4640' }}>
                  <input
                    type="checkbox"
                    checked={noInsurance}
                    onChange={e => setNoInsurance(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: '#1B3A6B', cursor: 'pointer' }}
                  />
                  I do not drive and do not require insurance
                </label>
              ) : undefined
            }
            doc={noInsurance ? undefined : getDoc('proof_of_insurance')}
            uploadState={uploadStates['proof_of_insurance']}
            onUploadChange={p => updateUpload('proof_of_insurance', p)}
            onUpload={() => handleUpload('proof_of_insurance', 'Proof of Insurance')}
          />
          {noInsurance && (
            <div style={{ margin: '-0.5rem 0', padding: '10px 14px', background: 'rgba(136,135,128,0.07)', border: '1px solid rgba(136,135,128,0.15)', borderRadius: '10px', fontSize: '12px', color: '#888780' }}>
              Insurance upload skipped — not applicable.
            </div>
          )}
        </div>

        {/* ── Background Check ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <SectionHead title="Background Check" icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ width: 14, height: 14 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          } />

          <DocCard
            docType="cpic_background_check"
            docLabel="CPIC Background Check"
            description="Upload your CPIC criminal record check. It must be dated within 30 days of your start date. If you do not have one, HR will advise you on next steps."
            required={false}
            needsExpiry={false}
            extra={
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 16px', background: 'rgba(27,58,107,0.04)', border: '1px solid rgba(27,58,107,0.1)', borderRadius: '10px' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round" style={{ width: 15, height: 15, flexShrink: 0, marginTop: 1 }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div style={{ fontSize: '12px', color: '#3A4A6B', lineHeight: 1.5 }}>
                  Your CPIC check is confidential and will only be reviewed by HR.
                </div>
              </div>
            }
            doc={getDoc('cpic_background_check')}
            uploadState={uploadStates['cpic_background_check']}
            onUploadChange={p => updateUpload('cpic_background_check', p)}
            onUpload={() => handleUpload('cpic_background_check', 'CPIC Background Check')}
          />
        </div>

        {/* ── Trade Licenses ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <SectionHead title="Trade Licenses" icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ width: 14, height: 14 }}>
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
            </svg>
          } />

          <div className="form-section-card">
            <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid rgba(0,0,0,0.06)', background: '#FAFAF8' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                <div className="form-section-heading">Trade Licenses</div>
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '100px', background: 'rgba(136,135,128,0.1)', color: '#888780', border: '1px solid rgba(136,135,128,0.15)', letterSpacing: '0.04em' }}>OPTIONAL</span>
              </div>
              <div className="form-section-heading-sub">Upload any trade licenses you hold. You can add multiple licenses.</div>
            </div>
            <div style={{ padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Existing trade licenses */}
              {getMultiDocs('trade_license').map(doc => (
                <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: '#F5F3EF', border: '1.5px solid #E2DED8', borderRadius: '12px' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round" style={{ width: 18, height: 18, flexShrink: 0 }}>
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#1a2e25' }}>{doc.document_label}</div>
                    <div style={{ fontSize: '11px', color: '#888780', marginTop: '2px' }}>
                      {doc.file_name}
                      {doc.expiry_date && <> · Expires {doc.expiry_date}{isExpiringSoon(doc.expiry_date) && <span style={{ color: '#C8920A', fontWeight: 700 }}> ⚠ Expiring soon</span>}</>}
                    </div>
                  </div>
                  <StatusBadge status={doc.form_status} />
                  {doc.form_status !== 'approved' && (
                    <button
                      onClick={() => handleDeleteDoc(doc.id)}
                      style={{ fontSize: '11px', fontWeight: 600, color: '#C0392B', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', fontFamily: 'var(--font-sans)', flexShrink: 0 }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              {/* Add trade license */}
              {tradeForm.open ? (
                <div style={{ background: 'rgba(27,58,107,0.03)', border: '1.5px solid rgba(27,58,107,0.12)', borderRadius: '14px', padding: '1.25rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#1a2e25', marginBottom: '1rem' }}>Add Trade License</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div className="form-field">
                      <label className="form-label">License Type <span className="form-label-required">*</span></label>
                      <select className="form-input" value={tradeForm.label} onChange={e => setTradeForm(f => ({ ...f, label: e.target.value }))}>
                        <option value="">Select type…</option>
                        {TRADE_LICENSE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">Expiry Date <span className="form-label-required">*</span></label>
                      <input type="date" className="form-input" value={tradeForm.expiry} onChange={e => setTradeForm(f => ({ ...f, expiry: e.target.value }))} />
                    </div>
                  </div>
                  <DropZone state={tradeForm} onChange={p => setTradeForm(f => ({ ...f, ...p }))} inputId="file-trade" />
                  {tradeForm.error && <div style={{ fontSize: '12px', color: '#C0392B', marginTop: '6px' }}>{tradeForm.error}</div>}
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button className="form-btn-secondary" onClick={() => setTradeForm({ ...EMPTY_MULTI })}>Cancel</button>
                    <button
                      className="form-btn-primary"
                      disabled={!tradeForm.file || !tradeForm.label || !tradeForm.expiry || tradeForm.uploading}
                      onClick={() => handleMultiUpload('trade_license', tradeForm, setTradeForm)}
                      style={{ fontSize: '12px', padding: '9px 18px', opacity: tradeForm.file && tradeForm.label && tradeForm.expiry && !tradeForm.uploading ? 1 : 0.45 }}
                    >
                      {tradeForm.uploading ? 'Uploading…' : 'Upload License'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setTradeForm(f => ({ ...f, open: true }))}
                  style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '10px 16px', borderRadius: '10px', border: '1.5px dashed rgba(27,58,107,0.2)', background: 'transparent', color: '#1B3A6B', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'border-color 0.2s, background 0.2s' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 14, height: 14 }}>
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add Trade License
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Safety Certifications ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <SectionHead title="Safety Certifications" icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ width: 14, height: 14 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <polyline points="9 12 11 14 15 10"/>
            </svg>
          } />

          <div className="form-section-card">
            <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid rgba(0,0,0,0.06)', background: '#FAFAF8' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                <div className="form-section-heading">Safety Certifications</div>
                <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '100px', background: 'rgba(136,135,128,0.1)', color: '#888780', border: '1px solid rgba(136,135,128,0.15)', letterSpacing: '0.04em' }}>OPTIONAL</span>
              </div>
              <div className="form-section-heading-sub">Upload your current safety certifications. You can add multiple certifications — this saves you from having to redo certifications you already hold.</div>
            </div>
            <div style={{ padding: '1.5rem 1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {getMultiDocs('safety_certification').map(doc => (
                <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: '#F5F3EF', border: '1.5px solid #E2DED8', borderRadius: '12px' }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="1.8" strokeLinecap="round" style={{ width: 18, height: 18, flexShrink: 0 }}>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '13px', color: '#1a2e25' }}>{doc.document_label}</div>
                    <div style={{ fontSize: '11px', color: '#888780', marginTop: '2px' }}>
                      {doc.file_name}
                      {doc.expiry_date && <> · Expires {doc.expiry_date}{isExpiringSoon(doc.expiry_date) && <span style={{ color: '#C8920A', fontWeight: 700 }}> ⚠ Expiring soon</span>}</>}
                    </div>
                  </div>
                  <StatusBadge status={doc.form_status} />
                  {doc.form_status !== 'approved' && (
                    <button
                      onClick={() => handleDeleteDoc(doc.id)}
                      style={{ fontSize: '11px', fontWeight: 600, color: '#C0392B', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: '6px', fontFamily: 'var(--font-sans)', flexShrink: 0 }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              {certForm.open ? (
                <div style={{ background: 'rgba(13,92,70,0.03)', border: '1.5px solid rgba(13,92,70,0.12)', borderRadius: '14px', padding: '1.25rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '13px', color: '#1a2e25', marginBottom: '1rem' }}>Add Safety Certification</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div className="form-field">
                      <label className="form-label">Certification Type <span className="form-label-required">*</span></label>
                      <select className="form-input" value={certForm.label} onChange={e => setCertForm(f => ({ ...f, label: e.target.value }))}>
                        <option value="">Select type…</option>
                        {CERT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="form-field">
                      <label className="form-label">Expiry Date <span className="form-label-required">*</span></label>
                      <input type="date" className="form-input" value={certForm.expiry} onChange={e => setCertForm(f => ({ ...f, expiry: e.target.value }))} />
                    </div>
                  </div>
                  <DropZone state={certForm} onChange={p => setCertForm(f => ({ ...f, ...p }))} inputId="file-cert" />
                  {certForm.error && <div style={{ fontSize: '12px', color: '#C0392B', marginTop: '6px' }}>{certForm.error}</div>}
                  <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button className="form-btn-secondary" onClick={() => setCertForm({ ...EMPTY_MULTI })}>Cancel</button>
                    <button
                      className="form-btn-primary"
                      disabled={!certForm.file || !certForm.label || !certForm.expiry || certForm.uploading}
                      onClick={() => handleMultiUpload('safety_certification', certForm, setCertForm)}
                      style={{ fontSize: '12px', padding: '9px 18px', opacity: certForm.file && certForm.label && certForm.expiry && !certForm.uploading ? 1 : 0.45 }}
                    >
                      {certForm.uploading ? 'Uploading…' : 'Upload Certification'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCertForm(f => ({ ...f, open: true }))}
                  style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '10px 16px', borderRadius: '10px', border: '1.5px dashed rgba(13,92,70,0.25)', background: 'transparent', color: '#0D5C46', fontSize: '13px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-sans)', transition: 'border-color 0.2s' }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: 14, height: 14 }}>
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add Safety Certification
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Work Authorization ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <SectionHead title="Work Authorization" icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ width: 14, height: 14 }}>
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          } />

          <DocCard
            docType="work_permit"
            docLabel="Work Permit"
            description="If you are not a Canadian citizen or permanent resident, please upload your current work permit."
            required={false}
            needsExpiry={true}
            doc={getDoc('work_permit')}
            uploadState={uploadStates['work_permit']}
            onUploadChange={p => updateUpload('work_permit', p)}
            onUpload={() => handleUpload('work_permit', 'Work Permit')}
          />
        </div>

        {/* ── Summary ── */}
        <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,0.07)', borderRadius: '20px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
          <div style={{ padding: '1.25rem 1.75rem', borderBottom: '1px solid rgba(0,0,0,0.06)', background: '#FAFAF8', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="form-section-icon navy">
              <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round" style={{ width: 18, height: 18 }}>
                <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
            </div>
            <div>
              <div className="form-section-heading">Document Summary</div>
              <div className="form-section-heading-sub">{requiredCount} of {REQUIRED_TYPES.length} required documents uploaded</div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              {summaryStatus === 'rejected' && <StatusBadge status="rejected" />}
              {summaryStatus === 'approved' && <StatusBadge status="approved" />}
              {summaryStatus === 'review'   && <StatusBadge status="review" />}
              {summaryStatus === 'pending'  && <StatusBadge status="pending" />}
            </div>
          </div>
          <div style={{ padding: '1.25rem 1.75rem', fontSize: '13px', color: '#5F5E5A', lineHeight: 1.6 }}>
            {anyRejected
              ? 'One or more documents have been rejected. Please re-upload the corrected documents above.'
              : allApproved
              ? 'All required documents have been approved by HR.'
              : 'HR will review your documents and notify you if anything needs to be corrected. You can still upload optional documents at any time.'}
            <div style={{ marginTop: '0.75rem' }}>
              <button className="form-btn-secondary" onClick={() => router.push(FORMS_HOME)}>
                ← Back to checklist
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
