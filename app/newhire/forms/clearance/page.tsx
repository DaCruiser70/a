'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import '../../../../styles/pages/form-pages.css'
import '../../../../styles/pages/clearance.css'
import { createClient } from '@/lib/supabase/client'
import { useMe } from '@/lib/use-me'
import { FORMS_HOME } from '@/lib/routes'
import {
  CLEARANCE_FILES_BUCKET, CLEARANCE_FILE_TYPES, CLEARANCE_MAX_BYTES,
  clearancePath, fileExt, formatDcn, isValidDcn, normalizeDcn, type ClearanceKind,
} from '@/lib/clearance'
import type { DocStatus, FormStatus } from '@/types'

type OnFile = { name: string }
type Loaded = {
  type:        'rcmp' | 'pspc_rcmp'
  fingerprint: boolean
  rcmp:        boolean
  templates:   { fingerprint: boolean; rcmp: boolean }
  id:          { status: DocStatus; label: string } | null
  existing: {
    legalName: string; placeOfBirth: string; dcn: string
    fingerprint: OnFile | null; rcmp: OnFile | null
    formStatus: FormStatus | null; flagReason: string | null
  }
}

type FileState = { file: File | null; removeOnFile: boolean; error: string }
const EMPTY_FILE: FileState = { file: null, removeOnFile: false, error: '' }

const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  pending: 'Uploaded', review: 'Under review', approved: 'Approved', rejected: 'Rejected',
}

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const FlaggedBanner = ({ reason, source }: { reason?: string | null; source?: string | null }) => (
  <div role="alert" style={{
    background: 'rgba(231,76,60,0.08)', border: '1.5px solid rgba(231,76,60,0.3)',
    borderRadius: '14px', padding: '16px 18px', display: 'flex',
    alignItems: 'flex-start', gap: '12px', marginBottom: '1.5rem',
  }}>
    <svg viewBox="0 0 24 24" fill="none" stroke="#E74C3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: 20, height: 20, flexShrink: 0, marginTop: 1 }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    <div>
      <div style={{ fontWeight: 700, color: '#C0392B', fontSize: '14px', marginBottom: source ? '2px' : '6px' }}>Action Required</div>
      {source && (
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#C0392B', opacity: 0.75, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Flagged by {source}
        </div>
      )}
      {reason && <div style={{ color: '#7A1B12', fontSize: '13px', marginBottom: '6px', lineHeight: 1.5 }}>{reason}</div>}
      <div style={{ color: '#7A7875', fontSize: '13px', lineHeight: 1.5 }}>Please review and correct the information below, then resubmit.</div>
    </div>
  </div>
)

const ErrorLine = ({ message }: { message: string }) => (
  <div className="clr-error" role="alert">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    {message}
  </div>
)

// One upload: an "On file" card (View + X that removes only at resubmit), or a drop zone, or the chosen file
function FileField({
  kind, label, accept, hint, onFile, state, onChange,
}: {
  kind: ClearanceKind; label: string; accept: string; hint: string
  onFile: OnFile | null; state: FileState; onChange: (s: FileState) => void
}) {
  const [dragging, setDragging] = useState(false)
  const [viewing, setViewing]   = useState(false)
  const inputId = `clr-${kind}-file`

  function pick(file: File | undefined) {
    if (!file) return
    const ext = fileExt(file.name)
    if (!CLEARANCE_FILE_TYPES[kind][ext]) {
      onChange({ ...state, error: `Unsupported file type. ${hint}` })
      return
    }
    if (file.size > CLEARANCE_MAX_BYTES) {
      onChange({ ...state, error: 'File is too large. Maximum size is 10 MB.' })
      return
    }
    onChange({ ...state, file, error: '' })
  }

  async function view() {
    setViewing(true)
    try {
      const res = await fetch(`/api/forms/clearance/file/${kind}`)
      if (!res.ok) { onChange({ ...state, error: 'Could not open your file. Please try again.' }); return }
      const { url } = await res.json()
      window.open(url, '_blank', 'noopener')
    } catch {
      onChange({ ...state, error: 'Could not open your file. Please try again.' })
    } finally {
      setViewing(false)
    }
  }

  return (
    <div className="form-field span-2">
      <span className="form-label" id={`${inputId}-label`}>{label} <span className="form-label-required" aria-hidden="true">*</span></span>

      {!state.file && onFile && !state.removeOnFile ? (
        <div className="clr-file">
          <svg className="clr-file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          <div className="clr-file-main"><div className="clr-file-name">{onFile.name}</div></div>
          <span className="clr-onfile">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            On file
          </span>
          <button type="button" className="clr-file-btn" onClick={view} disabled={viewing}>{viewing ? 'Opening…' : 'View'}</button>
          <button type="button" className="clr-file-x" aria-label={`Remove ${label.toLowerCase()}`} onClick={() => onChange({ ...state, removeOnFile: true, error: '' })}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      ) : state.file ? (
        <div className="clr-file">
          <svg className="clr-file-icon" viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
          <div className="clr-file-main">
            <div className="clr-file-name">{state.file.name}</div>
            <div className="clr-file-meta">{formatBytes(state.file.size)} · uploads when you submit</div>
          </div>
          <button type="button" className="clr-file-btn" onClick={() => onChange({ ...state, file: null })}>Remove</button>
        </div>
      ) : (
        <label
          className={`clr-upload${dragging ? ' dragging' : ''}`}
          htmlFor={inputId}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]) }}
        >
          <span className="clr-upload-title">Drop the completed file here, or <span>browse files</span></span>
          <span className="clr-upload-sub">{hint}</span>
          <input id={inputId} type="file" accept={accept} aria-labelledby={`${inputId}-label`} onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} />
        </label>
      )}

      {state.removeOnFile && onFile && !state.file && (
        <div className="clr-muted">Your current file stays on record until you resubmit.</div>
      )}
      {state.error && <ErrorLine message={state.error} />}
    </div>
  )
}

function TemplateDownload({ kind, available, title, sub }: { kind: ClearanceKind; available: boolean; title: string; sub: string }) {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(!available)

  async function download() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/forms/clearance/template/${kind}`)
      if (res.status === 404) { setMissing(true); return }
      if (!res.ok) { setError('Could not download the form. Please try again.'); return }
      const { url } = await res.json()
      window.location.href = url
    } catch {
      setError('Could not download the form. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="span-2" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div className="clr-download">
        <div>
          <div className="clr-download-label">{title}</div>
          <div className="clr-download-sub">{sub}</div>
        </div>
        {missing
          ? <span className="clr-soon">Form coming soon from HR</span>
          : <button type="button" className="form-btn-secondary" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download blank form'}</button>}
      </div>
      {error && <ErrorLine message={error} />}
    </div>
  )
}

export default function ClearanceForm() {
  const router = useRouter()
  const { me } = useMe()
  const userName = me?.name ?? ''

  const [load, setLoad]       = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [data, setData]       = useState<Loaded | null>(null)
  const [flagSource, setFlagSource] = useState<string | null>(null)

  const [legalName, setLegalName]       = useState('')
  const [placeOfBirth, setPlaceOfBirth] = useState('')
  const [dcn, setDcn]                   = useState('')   // digits only
  const [fingerprint, setFingerprint]   = useState<FileState>(EMPTY_FILE)
  const [rcmp, setRcmp]                 = useState<FileState>(EMPTY_FILE)
  const [fieldErrors, setFieldErrors]   = useState<Record<string, string>>({})
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState('')

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/forms/clearance', { cache: 'no-store' }),
      fetch('/api/newhire/flag-sources').then(r => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(async ([res, sources]) => {
      if (cancelled) return
      if (res.status === 403) { setLoad('unavailable'); return }
      if (!res.ok) { setLoad('error'); return }
      const d: Loaded = await res.json()
      setData(d)
      setLegalName(d.existing.legalName)
      setPlaceOfBirth(d.existing.placeOfBirth)
      setDcn(normalizeDcn(d.existing.dcn))
      setFlagSource(sources?.sources?.clearance ?? null)
      setLoad('ready')
    }).catch(() => { if (!cancelled) setLoad('error') })
    return () => { cancelled = true }
  }, [attempt])

  function validate(d: Loaded): Record<string, string> {
    const errors: Record<string, string> = {}
    if (!legalName.trim())    errors.legalName    = 'Enter your full legal name.'
    if (!placeOfBirth.trim()) errors.placeOfBirth = 'Enter your place of birth.'
    if (d.fingerprint && dcn && !isValidDcn(dcn)) errors.dcn = 'The DCN must be exactly 20 digits.'
    const hasFingerprint = !!fingerprint.file || (!!d.existing.fingerprint && !fingerprint.removeOnFile)
    const hasRcmp        = !!rcmp.file || (!!d.existing.rcmp && !rcmp.removeOnFile)
    if (d.fingerprint && !hasFingerprint) errors.fingerprint = 'Upload your completed fingerprint form.'
    if (!hasRcmp) errors.rcmp = 'Upload your completed RCMP form.'
    return errors
  }

  async function upload(kind: ClearanceKind, file: File): Promise<string | null> {
    const ext = fileExt(file.name)
    const contentType = CLEARANCE_FILE_TYPES[kind][ext]
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !contentType) return null
    const path = clearancePath(user.id, kind, ext)
    // Into the hire's own folder only; the server re-checks the path, type, size and signature
    const { error } = await supabase.storage.from(CLEARANCE_FILES_BUCKET).upload(path, file, { upsert: true, contentType })
    return error ? null : path
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!data || !data.id) return
    const errors = validate(data)
    setFieldErrors(errors)
    setSaveError('')
    if (Object.keys(errors).length) { setSaveError('Some answers need attention before you can submit.'); return }

    setSaving(true)
    try {
      let fingerprintPath: string | null = null
      let rcmpPath: string | null = null
      if (data.fingerprint && fingerprint.file) {
        fingerprintPath = await upload('fingerprint', fingerprint.file)
        if (!fingerprintPath) { setSaveError('Failed to upload the fingerprint form. Please try again.'); return }
      }
      if (rcmp.file) {
        rcmpPath = await upload('rcmp', rcmp.file)
        if (!rcmpPath) { setSaveError('Failed to upload the RCMP form. Please try again.'); return }
      }

      const res = await fetch('/api/forms/clearance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName:         legalName.trim(),
          placeOfBirth:      placeOfBirth.trim(),
          dcn:               data.fingerprint ? dcn : '',
          fingerprintPath,
          fingerprintName:   fingerprint.file && fingerprintPath ? fingerprint.file.name : undefined,
          removeFingerprint: data.fingerprint && !fingerprintPath && fingerprint.removeOnFile,
          rcmpPath,
          rcmpName:          rcmp.file && rcmpPath ? rcmp.file.name : undefined,
          removeRcmp:        !rcmpPath && rcmp.removeOnFile,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSaveError(body.error ?? 'Failed to save. Please try again.')
        return
      }
      // replace, so the browser Back button doesn't return to the submitted form
      router.replace(FORMS_HOME)
    } catch {
      setSaveError('Could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const formStatus = data?.existing.formStatus ?? null

  return (
    <div className="form-page">
      <nav className="form-page-nav">
        <div className="form-page-nav-left">
          <Image src="/logo.png" alt="AEM" width={120} height={32} className="form-page-nav-logo" />
          <div className="form-page-nav-div" />
          <span className="form-page-nav-label">Employee Onboarding Portal</span>
        </div>
        <div className="form-page-nav-right">
          <div className="form-page-nav-user">
            <div className="form-page-nav-avatar" aria-hidden="true">{userName ? getInitials(userName) : '…'}</div>
            {userName && <span className="form-page-nav-name">{userName}</span>}
          </div>
        </div>
      </nav>

      <div className="form-page-header">
        <div className="form-page-header-orb" />
        <div className="form-page-header-inner">
          <button className="form-page-back" onClick={() => router.push(FORMS_HOME)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to checklist
          </button>
          <div className="form-page-step-tag">Unlocked by your manager</div>
          <h1 className="form-page-title">Security Clearance</h1>
          <p className="form-page-sub">
            Your role needs a security clearance. Everything you enter here is encrypted and only
            visible to the HR team.
          </p>
        </div>
      </div>

      {load === 'loading' && (
        <div className="form-page-body" aria-busy="true" aria-label="Loading form">
          <div className="clr-skeleton" /><div className="clr-skeleton" />
        </div>
      )}

      {load === 'unavailable' && (
        <div className="form-page-body">
          <div className="clr-empty">
            <div className="clr-empty-title">This form isn&apos;t available</div>
            <div className="clr-empty-text">Your manager hasn&apos;t asked for a security clearance for your role. Nothing else is needed here.</div>
            <Link href={FORMS_HOME} className="form-btn-secondary">← Back to checklist</Link>
          </div>
        </div>
      )}

      {load === 'error' && (
        <div className="form-page-body">
          <div className="clr-empty">
            <div className="clr-empty-title">The form could not be loaded</div>
            <div className="clr-empty-text">Check your connection and try again.</div>
            <button type="button" className="form-btn-secondary" onClick={() => { setLoad('loading'); setAttempt(a => a + 1) }}>Try again</button>
          </div>
        </div>
      )}

      {load === 'ready' && data && (
        <form className="form-page-body" onSubmit={handleSubmit} noValidate>
          {formStatus === 'flagged' && <FlaggedBanner reason={data.existing.flagReason} source={flagSource} />}

          {/* ── NAME & PLACE OF BIRTH ── */}
          <div className="form-section-card">
            <div className="form-section-header">
              <div className="form-section-icon navy">
                <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <div>
                <div className="form-section-heading">Legal name and place of birth</div>
                <div className="form-section-heading-sub">Exactly as they appear on your ID</div>
              </div>
            </div>
            <div className="form-section-body">
              <div className="form-field">
                <label className="form-label" htmlFor="clr-legal-name">
                  Full legal name <span className="form-label-required" aria-hidden="true">*</span>
                  <span className="form-label-encrypted">🔒 Encrypted</span>
                </label>
                <input
                  id="clr-legal-name" className="form-input" value={legalName} maxLength={200}
                  autoComplete="name" aria-required="true" aria-invalid={!!fieldErrors.legalName || undefined}
                  onChange={e => setLegalName(e.target.value)}
                />
                {fieldErrors.legalName && <ErrorLine message={fieldErrors.legalName} />}
              </div>
              <div className="form-field">
                <label className="form-label" htmlFor="clr-pob">
                  Place of birth <span className="form-label-required" aria-hidden="true">*</span>
                  <span className="form-label-encrypted">🔒 Encrypted</span>
                </label>
                <input
                  id="clr-pob" className="form-input" value={placeOfBirth} maxLength={200}
                  placeholder="City, province or state, country"
                  aria-required="true" aria-invalid={!!fieldErrors.placeOfBirth || undefined}
                  onChange={e => setPlaceOfBirth(e.target.value)}
                />
                {fieldErrors.placeOfBirth && <ErrorLine message={fieldErrors.placeOfBirth} />}
              </div>
            </div>
          </div>

          {/* ── FINGERPRINT (PSPC & RCMP only) ── */}
          {data.fingerprint && (
            <div className="form-section-card">
              <div className="form-section-header">
                <div className="form-section-icon amber">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 11c0 3.5-1 6.5-3 9"/><path d="M8 7.5a5 5 0 0 1 9 3c0 2.5-.5 5-1.5 7"/><path d="M5 10a7 7 0 0 1 13.5-3"/><path d="M15 21c.5-1 1-2.5 1-4"/>
                  </svg>
                </div>
                <div>
                  <div className="form-section-heading">Fingerprint form</div>
                  <div className="form-section-heading-sub">Needed for the PSPC clearance</div>
                </div>
              </div>
              <div className="form-section-body">
                <TemplateDownload kind="fingerprint" available={data.templates.fingerprint}
                  title="Blank fingerprint form" sub="PDF — print it and bring it to your appointment" />

                <ol className="clr-steps span-2">
                  <li>Take the printed form to an <strong>accredited fingerprint provider</strong>.</li>
                  <li>The provider takes your fingerprints and <strong>completes the DCN section</strong>.</li>
                  <li>Scan or photograph the completed form and upload it below.</li>
                </ol>

                <div className="form-field span-2">
                  <label className="form-label" htmlFor="clr-dcn">
                    DCN (optional)
                    <span className="form-label-encrypted">🔒 Encrypted</span>
                  </label>
                  <input
                    id="clr-dcn" className="form-input sensitive clr-dcn" inputMode="numeric" autoComplete="off"
                    placeholder="00000-00000-00000-00000" value={formatDcn(dcn)}
                    aria-describedby="clr-dcn-hint" aria-invalid={!!fieldErrors.dcn || undefined}
                    onChange={e => setDcn(normalizeDcn(e.target.value).replace(/\D/g, '').slice(0, 20))}
                  />
                  <span id="clr-dcn-hint" className="form-input-hint">The 20-digit Document Control Number from your fingerprint provider, if you have it</span>
                  {fieldErrors.dcn && <ErrorLine message={fieldErrors.dcn} />}
                </div>

                <FileField
                  kind="fingerprint" label="Completed fingerprint form"
                  accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
                  hint="PNG, JPG or PDF up to 10 MB"
                  onFile={data.existing.fingerprint} state={fingerprint} onChange={setFingerprint}
                />
                {fieldErrors.fingerprint && <div className="span-2"><ErrorLine message={fieldErrors.fingerprint} /></div>}
              </div>
            </div>
          )}

          {/* ── RCMP FORM ── */}
          <div className="form-section-card">
            <div className="form-section-header">
              <div className="form-section-icon navy">
                <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>
                </svg>
              </div>
              <div>
                <div className="form-section-heading">RCMP form</div>
                <div className="form-section-heading-sub">Fill in your own details, then upload the completed file</div>
              </div>
            </div>
            <div className="form-section-body">
              <TemplateDownload kind="rcmp" available={data.templates.rcmp}
                title="Blank RCMP form" sub="Excel spreadsheet (.xlsx)" />

              <div className="form-sin-notice">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div className="form-sin-notice-text">HR will complete the RCMP detachments and file number sections.</div>
              </div>

              <FileField
                kind="rcmp" label="Completed RCMP form"
                accept=".xlsx,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
                hint="Excel (.xlsx) or PDF up to 10 MB — .xls and .xlsm files can't be accepted"
                onFile={data.existing.rcmp} state={rcmp} onChange={setRcmp}
              />
              {fieldErrors.rcmp && <div className="span-2"><ErrorLine message={fieldErrors.rcmp} /></div>}
            </div>
          </div>

          {/* ── ID (from Documents) ── */}
          <div className="form-section-card">
            <div className="form-section-header">
              <div className="form-section-icon green">
                <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><line x1="13" y1="10" x2="18" y2="10"/><line x1="13" y1="14" x2="17" y2="14"/>
                </svg>
              </div>
              <div>
                <div className="form-section-heading">Government ID</div>
                <div className="form-section-heading-sub">Collected once, in your Documents</div>
              </div>
            </div>
            <div className="form-section-body single-col">
              {data.id ? (
                <div className="clr-id">
                  <div className="clr-id-text"><strong>ID on file</strong> · {data.id.label} · {DOC_STATUS_LABELS[data.id.status]}</div>
                  <Link href="/newhire/forms/documents" className="clr-link">Open Documents</Link>
                </div>
              ) : (
                <div className="clr-id missing" role="alert">
                  <div className="clr-id-text"><strong>Upload your ID in Documents (front and back)</strong> before you submit this form.</div>
                  <Link href="/newhire/forms/documents" className="clr-link">Go to Documents</Link>
                </div>
              )}
            </div>

            <div className="form-actions">
              <div className="form-save-note">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Name, place of birth and DCN are encrypted
              </div>
              <div className="form-action-btns">
                {saveError && <div className="login-error" role="alert" style={{ marginBottom: 0 }}>{saveError}</div>}
                <button type="button" className="form-btn-secondary" onClick={() => router.push(FORMS_HOME)}>← Back</button>
                <button type="submit" className="form-btn-primary" disabled={saving || !data.id}>
                  {saving ? 'Saving…' : formStatus === 'flagged' ? 'Resubmit for review →' : 'Submit & return to checklist →'}
                </button>
              </div>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
