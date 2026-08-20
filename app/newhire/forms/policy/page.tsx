'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import '../../../../styles/pages/form-pages.css'
import { createClient } from '@/lib/supabase/client'

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

export default function PolicyForm() {
  const router = useRouter()
  const [agreed, setAgreed]         = useState(false)
  const [signature, setSignature]   = useState('')
  const [formStatus, setFormStatus] = useState('')
  const [flagReason, setFlagReason] = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState('')

  const today = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const { data } = await supabase
        .from('policy_acknowledgements')
        .select('signature,form_status,flag_reason')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!data) return
      setSignature(data.signature ?? '')
      setAgreed(true)
      setFormStatus(data.form_status ?? '')
      setFlagReason(data.flag_reason ?? null)
    }).catch(() => {})
  }, [])

  const canSubmit = agreed && signature.trim().length > 2

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setSaveError('')
    const res = await fetch('/api/forms/policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature }),
    })
    if (!res.ok) {
      const data = await res.json()
      setSaveError(data.error ?? 'Failed to save. Please try again.')
      setSaving(false)
      return
    }
    router.push(formStatus === 'flagged' ? '/newhire/forms' : '/newhire/complete')
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
          <button className="form-page-back" onClick={() => router.push('/newhire/forms/sin')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to SIN
          </button>
          <div className="form-page-step-tag">Step 4 of 4</div>
          <h1 className="form-page-title">Policy Acknowledgement</h1>
          <p className="form-page-sub">
            Please read the following policies carefully. By signing below, you confirm
            that you have read, understood, and agree to comply with all AEM policies.
          </p>
        </div>
      </div>

      <form className="form-page-body" onSubmit={handleSubmit}>

        {formStatus === 'flagged' && <FlaggedBanner reason={flagReason} />}

        <div className="form-section-card">
          <div className="form-section-header">
            <div className="form-section-icon green">
              <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="1.8" strokeLinecap="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div>
              <div className="form-section-heading">AEM Workplace Policies</div>
              <div className="form-section-heading-sub">Please read all sections before signing</div>
            </div>
          </div>

          <div className="form-section-body single-col">

            <div className="form-policy-box">
              <h4>1. Code of Conduct</h4>
              <p>All AEM employees are expected to conduct themselves professionally and with integrity at all times. This includes treating colleagues, clients, and partners with respect, maintaining confidentiality of business information, and representing AEM in a positive manner in all professional settings.</p>

              <h4>2. Health &amp; Safety Policy</h4>
              <p>AEM is committed to providing a safe working environment. All employees must follow established safety protocols, report hazards immediately, and participate in required safety training. No task or deadline is more important than the safety of our team. Failure to comply with health and safety standards may result in disciplinary action.</p>

              <h4>3. Privacy &amp; Confidentiality</h4>
              <p>Employees may have access to confidential information including client data, financial records, and proprietary business processes. This information must not be disclosed to unauthorized parties inside or outside the organization, during or after employment. Violations may result in termination and legal action.</p>

              <h4>4. Information Technology &amp; Acceptable Use</h4>
              <p>AEM systems, devices, and software are provided for business use. Personal use should be minimal and must not interfere with work responsibilities. Employees must not install unauthorized software, share login credentials, or access systems they are not authorized to use.</p>

              <h4>5. Workplace Harassment &amp; Discrimination</h4>
              <p>AEM has a zero-tolerance policy for harassment, bullying, or discrimination of any kind based on race, gender, age, religion, disability, sexual orientation, or any other protected characteristic. All employees are responsible for maintaining a respectful and inclusive workplace.</p>

              <h4>6. Social Media &amp; Communications</h4>
              <p>Employees must not share confidential AEM information on social media or public platforms. When discussing AEM professionally online, employees should ensure their statements are accurate and do not misrepresent the company&apos;s positions or values.</p>

              <h4>7. Conflicts of Interest</h4>
              <p>Employees must disclose any personal, financial, or other interests that may conflict with AEM&apos;s interests. This includes outside employment, business relationships, and investments that may influence professional judgment.</p>
            </div>

            <label className="form-checkbox-wrap">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={agreed}
                onChange={e => setAgreed(e.target.checked)}
                required
              />
              <span className="form-checkbox-label">
                <strong>I confirm that I have read, understood, and agree to comply</strong> with all
                of the above AEM workplace policies and the AEM Code of Conduct.
                I understand that failure to comply may result in disciplinary action up to and including termination.
              </span>
            </label>

            <div className="form-field">
              <label className="form-label">
                Full Legal Name (Signature) <span className="form-label-required">*</span>
              </label>
              <input
                className="form-input"
                style={{ fontStyle: 'italic', fontSize: '16px', fontFamily: 'Georgia, serif' }}
                value={signature}
                onChange={e => setSignature(e.target.value)}
                placeholder="Type your full legal name"
                required
              />
              <span className="form-input-hint">Type your full name exactly as it appears on your government ID</span>
            </div>

            <div className="form-field">
              <label className="form-label">Date</label>
              <input className="form-input" value={today} disabled style={{ color: '#888780', background: '#F5F3EF' }} />
            </div>

          </div>

          <div className="form-actions">
            <div className="form-save-note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
              </svg>
              Timestamped on submission
            </div>
            <div className="form-action-btns">
              <button type="button" className="form-btn-secondary" onClick={() => router.push('/newhire/forms/sin')}>
                ← Back
              </button>
              {saveError && <div className="login-error" style={{ marginBottom: 0 }}>{saveError}</div>}
              <button
                type="submit"
                className="form-btn-primary"
                disabled={!canSubmit || saving}
                style={{ opacity: canSubmit && !saving ? 1 : 0.5, cursor: canSubmit && !saving ? 'pointer' : 'not-allowed' }}
              >
                {saving ? 'Saving…' : formStatus === 'flagged' ? 'Resubmit for review →' : 'Sign & complete ✓'}
              </button>
            </div>
          </div>
        </div>

      </form>
    </div>
  )
}
