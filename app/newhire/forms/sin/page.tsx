'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import '../../../../styles/pages/form-pages.css'
import { createClient } from '@/lib/supabase/client'
import { FORMS_HOME } from '@/lib/routes'

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

const FlaggedBanner = ({ reason, source }: { reason?: string | null; source?: string | null }) => (
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
      <div style={{ fontWeight: 700, color: '#C0392B', fontSize: '14px', marginBottom: source ? '2px' : '6px' }}>Action Required</div>
      {source && (
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#C0392B', opacity: 0.75, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Flagged by {source}
        </div>
      )}
      {reason && (
        <div style={{ color: '#7A1B12', fontSize: '13px', marginBottom: '6px', lineHeight: 1.5 }}>{reason}</div>
      )}
      <div style={{ color: '#7A7875', fontSize: '13px', lineHeight: 1.5 }}>Please review and correct the information below, then resubmit.</div>
    </div>
  </div>
)

export default function SINForm() {
  const router = useRouter()
  const [sin, setSin]             = useState('')
  const [sinConfirm, setSinConfirm] = useState('')
  const [showSin, setShowSin]     = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [formStatus, setFormStatus]   = useState('')
  const [flagReason, setFlagReason]   = useState<string | null>(null)
  const [flagSource, setFlagSource]   = useState<string | null>(null)
  const [saving, setSaving]           = useState(false)
  const [saveError, setSaveError]     = useState('')
  const [userName, setUserName]       = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase.from('profiles').select('full_name').eq('id', user.id).single()
      if (data?.full_name) setUserName(data.full_name)
    }).catch(() => {})
  }, [])

  function formatSIN(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 9)
    if (digits.length <= 3) return digits
    if (digits.length <= 6) return `${digits.slice(0, 3)} ${digits.slice(3)}`
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/forms/sin').then(r => r.ok ? r.json() : null),
      fetch('/api/newhire/flag-sources').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([data, sourcesData]) => {
        if (data?.existing) {
          const formatted = formatSIN(data.existing.sin ?? '')
          setSin(formatted)
          setSinConfirm(formatted)
          setFormStatus(data.existing.formStatus ?? '')
          setFlagReason(data.existing.flagReason ?? null)
        }
        if (sourcesData?.sources?.sin) setFlagSource(sourcesData.sources.sin)
      })
      .catch(() => {})
  }, [])

  function handleSIN(e: React.ChangeEvent<HTMLInputElement>) { setSin(formatSIN(e.target.value)) }
  function handleConfirm(e: React.ChangeEvent<HTMLInputElement>) { setSinConfirm(formatSIN(e.target.value)) }

  const sinMatch = sin.length === 11 && sinConfirm.length === 11 && sin === sinConfirm

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!sinMatch) return
    setSaving(true)
    setSaveError('')
    const res = await fetch('/api/forms/sin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sin }),
    })
    if (!res.ok) {
      const data = await res.json()
      setSaveError(data.error ?? 'Failed to save. Please try again.')
      setSaving(false)
      return
    }
    // replace, so the browser Back button doesn't return to the submitted form
    router.replace(FORMS_HOME)
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
            <div className="form-page-nav-avatar">{userName ? getInitials(userName) : '…'}</div>
            {userName && <span className="form-page-nav-name">{userName}</span>}
          </div>
        </div>
      </nav>

      <div className="form-page-header">
        <div className="form-page-header-orb" />
        <div className="form-page-header-inner">
          <button className="form-page-back" onClick={() => router.push(FORMS_HOME)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to checklist
          </button>
          <div className="form-page-step-tag">Step 3 of 4</div>
          <h1 className="form-page-title">Social Insurance Number</h1>
          <p className="form-page-sub">
            Your SIN is required for payroll and tax purposes. It is encrypted
            with AES-256 the moment it leaves your browser and is never stored in plain text.
          </p>
        </div>
      </div>

      <form className="form-page-body" onSubmit={handleSubmit}>

        {formStatus === 'flagged' && <FlaggedBanner reason={flagReason} source={flagSource} />}

        <div className="form-section-card">
          <div className="form-section-header">
            <div className="form-section-icon amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="1.8" strokeLinecap="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <div>
              <div className="form-section-heading">Social Insurance Number</div>
              <div className="form-section-heading-sub">9-digit number on your SIN card or CRA documents</div>
            </div>
          </div>

          <div className="form-section-body single-col">

            <div className="form-sin-notice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <div className="form-sin-notice-text">
                <strong>Maximum security.</strong> Your SIN is encrypted with AES-256 encryption
                on the server before it is stored. No one at AEM can see your raw SIN number
                without a verified HR identity check. This portal uses HTTPS/TLS throughout.
              </div>
            </div>

            <div className="form-field">
              <label className="form-label">
                Social Insurance Number <span className="form-label-required">*</span>
                <span className="form-label-encrypted">🔒 AES-256 Encrypted</span>
              </label>
              <div className="form-sensitive-wrap">
                <input
                  className="form-input sensitive"
                  type={showSin ? 'text' : 'password'}
                  value={sin}
                  onChange={handleSIN}
                  placeholder="000 000 000"
                  required
                />
                <button type="button" className="form-sensitive-toggle" onClick={() => setShowSin(v => !v)} aria-label="Toggle SIN visibility">
                  {showSin ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              <span className="form-input-hint">Enter your 9-digit SIN — it will be formatted automatically</span>
            </div>

            <div className="form-field">
              <label className="form-label">
                Confirm SIN <span className="form-label-required">*</span>
              </label>
              <div className="form-sensitive-wrap">
                <input
                  className="form-input sensitive"
                  type={showConfirm ? 'text' : 'password'}
                  value={sinConfirm}
                  onChange={handleConfirm}
                  placeholder="000 000 000"
                  required
                />
                <button type="button" className="form-sensitive-toggle" onClick={() => setShowConfirm(v => !v)} aria-label="Toggle confirm visibility">
                  {showConfirm ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              {sinConfirm.length > 0 && (
                <span className="form-input-hint" style={{ color: sinMatch ? '#0D5C46' : '#C0392B' }}>
                  {sinMatch ? '✓ SIN numbers match' : 'SIN numbers do not match'}
                </span>
              )}
            </div>

          </div>

          <div className="form-actions">
            <div className="form-save-note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
              </svg>
              Encrypted before saving
            </div>
            <div className="form-action-btns">
              <button type="button" className="form-btn-secondary" onClick={() => router.push(FORMS_HOME)}>
                ← Back
              </button>
              {saveError && <div className="login-error" style={{ marginBottom: 0 }}>{saveError}</div>}
              <button
                type="submit"
                className="form-btn-primary"
                disabled={!sinMatch || saving}
                style={{ opacity: sinMatch && !saving ? 1 : 0.5, cursor: sinMatch && !saving ? 'pointer' : 'not-allowed' }}
              >
                {saving ? 'Saving…' : formStatus === 'flagged' ? 'Resubmit for review →' : 'Save & return to checklist →'}
              </button>
            </div>
          </div>
        </div>

      </form>
    </div>
  )
}
