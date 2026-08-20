'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import '../../../../styles/pages/form-pages.css'
import { createClient } from '@/lib/supabase/client'

function ChequePreviewImage({ src }: { src: string }) {
  return <img src={src} alt="Void cheque preview" className="banking-cheque-preview-img" /> // eslint-disable-line @next/next/no-img-element
}

const FlaggedBanner = ({ reason }: { reason?: string | null }) => (
  <div style={{
    background: 'rgba(231,76,60,0.08)', border: '1.5px solid rgba(231,76,60,0.3)',
    borderRadius: '14px', padding: '16px 18px', display: 'flex',
    alignItems: 'flex-start', gap: '12px', marginBottom: '1.5rem',
  }}>
    <svg viewBox="0 0 24 24" fill="none" stroke="#E74C3C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 20, height: 20, flexShrink: 0, marginTop: 1 }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
    <div>
      <div style={{ fontWeight: 700, color: '#C0392B', fontSize: '14px', marginBottom: '6px' }}>Action Required</div>
      {reason && (
        <div style={{ color: '#7A1B12', fontSize: '13px', marginBottom: '6px', lineHeight: 1.5 }}>{reason}</div>
      )}
      <div style={{ color: '#7A7875', fontSize: '13px', lineHeight: 1.5 }}>Please review and correct the information below, then resubmit.</div>
    </div>
  </div>
)

export default function BankingForm() {
  const router = useRouter()
  const [form, setForm] = useState({
    bankName: '',
    accountType: '',
    institutionNumber: '',
    transitNumber: '',
    accountNumber: '',
  })
  const [formStatus, setFormStatus]   = useState('')
  const [flagReason, setFlagReason]   = useState<string | null>(null)
  const [showAccount, setShowAccount] = useState(false)
  const [chequeFile, setChequeFile]   = useState<File | null>(null)
  const [chequePreview, setChequePreview] = useState<string | null>(null)
  const [isDragging, setIsDragging]   = useState(false)
  const fileInputRef                  = useRef<HTMLInputElement>(null)
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState('')

  useEffect(() => {
    fetch('/api/forms/banking')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.existing) return
        const e = data.existing
        setForm({
          bankName:          e.bankName          ?? '',
          accountType:       e.accountType       ?? '',
          institutionNumber: e.institutionNumber ?? '',
          transitNumber:     e.transitNumber     ?? '',
          accountNumber:     e.accountNumber     ?? '',
        })
        setFormStatus(e.formStatus ?? '')
        setFlagReason(e.flagReason ?? null)
      })
      .catch(() => {})
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  function handleFile(file: File) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowed.includes(file.type)) return
    setChequeFile(file)
    if (file.type !== 'application/pdf') {
      const reader = new FileReader()
      reader.onload = (e) => setChequePreview(e.target?.result as string)
      reader.readAsDataURL(file)
    } else {
      setChequePreview(null)
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(true)
  }

  function handleDragLeave() { setIsDragging(false) }

  function removeFile() {
    setChequeFile(null)
    setChequePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setSaveError('')

    let voidChequePath: string | null = null

    if (chequeFile) {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const ext = chequeFile.name.split('.').pop() ?? 'jpg'
        const path = `${user.id}/void-cheque.${ext}`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('void-cheques')
          .upload(path, chequeFile, { upsert: true })
        if (uploadError) {
          setSaveError('Failed to upload void cheque. Please try again.')
          setSaving(false)
          return
        }
        if (uploadData) voidChequePath = uploadData.path
      }
    }

    const res = await fetch('/api/forms/banking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bankName:          form.bankName,
        accountType:       form.accountType,
        institutionNumber: form.institutionNumber,
        transitNumber:     form.transitNumber,
        accountNumber:     form.accountNumber,
        voidChequePath,
      }),
    })
    if (!res.ok) {
      const data = await res.json()
      setSaveError(data.error ?? 'Failed to save. Please try again.')
      setSaving(false)
      return
    }
    router.push(formStatus === 'flagged' ? '/newhire/forms' : '/newhire/forms/sin')
  }

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
            <div className="form-page-nav-avatar">LD</div>
            <span className="form-page-nav-name">Lucas DaCruz</span>
          </div>
        </div>
      </nav>

      <div className="form-page-header">
        <div className="form-page-header-orb" />
        <div className="form-page-header-inner">
          <button className="form-page-back" onClick={() => router.push('/newhire/forms/personal')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to Personal Information
          </button>
          <div className="form-page-step-tag">Step 2 of 4</div>
          <h1 className="form-page-title">Banking &amp; Direct Deposit</h1>
          <p className="form-page-sub">
            Your banking details for payroll direct deposit. All information is
            encrypted and only accessible to the HR and payroll teams.
          </p>
        </div>
      </div>

      <form className="form-page-body" onSubmit={handleSubmit}>

        {formStatus === 'flagged' && <FlaggedBanner reason={flagReason} />}

        <div className="form-section-card">
          <div className="form-section-header">
            <div className="form-section-icon amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="1.8" strokeLinecap="round">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <line x1="2" y1="10" x2="22" y2="10"/>
              </svg>
            </div>
            <div>
              <div className="form-section-heading">Bank Account Details</div>
              <div className="form-section-heading-sub">Found on a void cheque or through online banking</div>
            </div>
          </div>
          <div className="form-section-body">

            <div className="form-field">
              <label className="form-label">Bank Name <span className="form-label-required">*</span></label>
              <select className="form-input" name="bankName" value={form.bankName} onChange={handleChange} required>
                <option value="">Select your bank</option>
                <option>Royal Bank of Canada (RBC)</option>
                <option>Toronto-Dominion Bank (TD)</option>
                <option>Bank of Nova Scotia (Scotiabank)</option>
                <option>Bank of Montreal (BMO)</option>
                <option>Canadian Imperial Bank of Commerce (CIBC)</option>
                <option>National Bank of Canada</option>
                <option>HSBC Canada</option>
                <option>Desjardins</option>
                <option>Other</option>
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">Account Type <span className="form-label-required">*</span></label>
              <select className="form-input" name="accountType" value={form.accountType} onChange={handleChange} required>
                <option value="">Select account type</option>
                <option>Chequing</option>
                <option>Savings</option>
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">
                Institution Number <span className="form-label-required">*</span>
                <span className="form-label-encrypted">🔒 Encrypted</span>
              </label>
              <input className="form-input sensitive" name="institutionNumber" value={form.institutionNumber} onChange={handleChange} placeholder="3 digits" maxLength={3} required />
              <span className="form-input-hint">3-digit number identifying your bank</span>
            </div>

            <div className="form-field">
              <label className="form-label">
                Transit Number <span className="form-label-required">*</span>
                <span className="form-label-encrypted">🔒 Encrypted</span>
              </label>
              <input className="form-input sensitive" name="transitNumber" value={form.transitNumber} onChange={handleChange} placeholder="5 digits" maxLength={5} required />
              <span className="form-input-hint">5-digit branch number</span>
            </div>

            <div className="form-field span-2">
              <label className="form-label">
                Account Number <span className="form-label-required">*</span>
                <span className="form-label-encrypted">🔒 Encrypted</span>
              </label>
              <div className="form-sensitive-wrap">
                <input
                  className="form-input sensitive"
                  name="accountNumber"
                  type={showAccount ? 'text' : 'password'}
                  value={form.accountNumber}
                  onChange={handleChange}
                  placeholder="7–12 digits"
                  required
                />
                <button type="button" className="form-sensitive-toggle" onClick={() => setShowAccount(v => !v)} aria-label="Toggle visibility">
                  {showAccount ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              <span className="form-input-hint">Your account number as it appears on your cheque or bank statement</span>
            </div>

            <div className="form-sin-notice span-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <div className="form-sin-notice-text">
                <strong>Your banking details are encrypted.</strong> Institution, transit, and account numbers
                are encrypted with AES-256 before being stored. Only authorized HR and payroll staff can access this information.
              </div>
            </div>

          </div>
        </div>

        {/* ── VOID CHEQUE UPLOAD ── */}
        <div className="form-section-card">
          <div className="form-section-header">
            <div className="form-section-icon navy">
              <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <div>
              <div className="form-section-heading">Void Cheque</div>
              <div className="form-section-heading-sub">Upload a photo or scan — used to verify your banking details</div>
            </div>
          </div>

          <div className="form-section-body single-col">
            <div className="form-sin-notice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <div className="form-sin-notice-text">
                <strong>What is a void cheque?</strong> A void cheque is a personal cheque with &quot;VOID&quot; written across it.
                It shows your institution number, transit number, and account number at the bottom.
                If you don&apos;t have cheques, your bank can provide a direct deposit form which works the same way.
              </div>
            </div>

            {!chequeFile ? (
              <div
                className={`banking-upload-zone${isDragging ? ' dragging' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
              >
                <div className="banking-upload-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                </div>
                <div className="banking-upload-title">Drop your void cheque here, or <span>browse files</span></div>
                <div className="banking-upload-sub">JPG, PNG, PDF up to 10MB · Your file is stored securely</div>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={handleFileInput} style={{ display: 'none' }} />
              </div>
            ) : (
              <div className="banking-upload-preview">
                {chequePreview ? (
                  <ChequePreviewImage src={chequePreview} />
                ) : (
                  <div className="banking-pdf-preview">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.6" strokeLinecap="round" style={{ width: '36px', height: '36px' }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span>{chequeFile.name}</span>
                  </div>
                )}
                <div className="banking-preview-footer">
                  <div className="banking-preview-info">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="2" strokeLinecap="round" style={{ width: '14px', height: '14px' }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span style={{ fontSize: '12px', color: '#0D5C46', fontWeight: 600 }}>{chequeFile.name}</span>
                    <span style={{ fontSize: '11px', color: '#888780' }}>({(chequeFile.size / 1024).toFixed(0)} KB)</span>
                  </div>
                  <button type="button" className="banking-remove-btn" onClick={removeFile}>Remove</button>
                </div>
              </div>
            )}
          </div>

          <div className="form-actions">
            <div className="form-save-note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                <polyline points="17 21 17 13 7 13 7 21"/>
                <polyline points="7 3 7 8 15 8"/>
              </svg>
              Progress saved automatically
            </div>
            <div className="form-action-btns">
              {saveError && <div className="login-error" style={{ marginBottom: 0 }}>{saveError}</div>}
              <button type="button" className="form-btn-secondary" onClick={() => router.push('/newhire/forms/personal')}>
                ← Back
              </button>
              <button type="submit" className="form-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : formStatus === 'flagged' ? 'Resubmit for review →' : 'Save & continue →'}
              </button>
            </div>
          </div>
        </div>

      </form>
    </div>
  )
}
