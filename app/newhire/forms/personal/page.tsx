'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import '../../../../styles/pages/form-pages.css'
import { createClient } from '@/lib/supabase/client'

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

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

export default function PersonalInfoForm() {
  const router = useRouter()
  const [form, setForm] = useState({
    firstName: '', lastName: '', dateOfBirth: '',
    phone: '', email: '',
    street: '', city: '', province: '', postalCode: '',
    emergencyName: '', emergencyRelationship: '', emergencyPhone: '',
  })
  const [formStatus, setFormStatus] = useState('')
  const [flagReason, setFlagReason] = useState<string | null>(null)
  const [flagSource, setFlagSource] = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [saveError, setSaveError]   = useState('')
  const [userName, setUserName]     = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return
      const [{ data }, { data: profile }, sourcesRes] = await Promise.all([
        supabase
          .from('personal_info')
          .select('first_name,last_name,date_of_birth,phone,personal_email,street,city,province,postal_code,emergency_name,emergency_relationship,emergency_phone,form_status,flag_reason')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase.from('profiles').select('full_name').eq('id', user.id).single(),
        fetch('/api/newhire/flag-sources').then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      if (profile?.full_name) setUserName(profile.full_name)
      if (sourcesRes?.sources?.personal) setFlagSource(sourcesRes.sources.personal)
      if (!data) return
      setForm({
        firstName:             data.first_name             ?? '',
        lastName:              data.last_name              ?? '',
        dateOfBirth:           data.date_of_birth          ?? '',
        phone:                 data.phone                  ?? '',
        email:                 data.personal_email         ?? '',
        street:                data.street                 ?? '',
        city:                  data.city                   ?? '',
        province:              data.province               ?? '',
        postalCode:            data.postal_code            ?? '',
        emergencyName:         data.emergency_name         ?? '',
        emergencyRelationship: data.emergency_relationship ?? '',
        emergencyPhone:        data.emergency_phone        ?? '',
      })
      setFormStatus(data.form_status ?? '')
      setFlagReason(data.flag_reason ?? null)
    }).catch(() => {})
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setSaveError('')
    const res = await fetch('/api/forms/personal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!res.ok) {
      const data = await res.json()
      setSaveError(data.error ?? 'Failed to save. Please try again.')
      setSaving(false)
      return
    }
    router.push(formStatus === 'flagged' ? '/newhire/forms' : '/newhire/forms/banking')
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
          <button className="form-page-back" onClick={() => router.push('/newhire/forms')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Back to checklist
          </button>
          <div className="form-page-step-tag">Step 1 of 4</div>
          <h1 className="form-page-title">Personal Information</h1>
          <p className="form-page-sub">
            Your basic details, contact information, and emergency contact.
            This information is used for payroll, HR records, and workplace safety.
          </p>
        </div>
      </div>

      <form className="form-page-body" onSubmit={handleSubmit}>

        {formStatus === 'flagged' && <FlaggedBanner reason={flagReason} source={flagSource} />}

        {/* ── BASIC INFO ── */}
        <div className="form-section-card">
          <div className="form-section-header">
            <div className="form-section-icon navy">
              <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div>
              <div className="form-section-heading">Basic Information</div>
              <div className="form-section-heading-sub">Your legal name and date of birth</div>
            </div>
          </div>
          <div className="form-section-body">
            <div className="form-field">
              <label className="form-label">First Name <span className="form-label-required">*</span></label>
              <input className="form-input" name="firstName" value={form.firstName} onChange={handleChange} placeholder="John" required />
            </div>
            <div className="form-field">
              <label className="form-label">Last Name <span className="form-label-required">*</span></label>
              <input className="form-input" name="lastName" value={form.lastName} onChange={handleChange} placeholder="Smith" required />
            </div>
            <div className="form-field">
              <label className="form-label">Date of Birth <span className="form-label-required">*</span></label>
              <input className="form-input" type="date" name="dateOfBirth" value={form.dateOfBirth} onChange={handleChange} required />
            </div>
            <div className="form-field">
              <label className="form-label">Personal Email <span className="form-label-required">*</span></label>
              <input className="form-input" type="email" name="email" value={form.email} onChange={handleChange} placeholder="john@email.com" required />
              <span className="form-input-hint">Your personal email — not your AEM address</span>
            </div>
            <div className="form-field">
              <label className="form-label">Phone Number <span className="form-label-required">*</span></label>
              <input className="form-input" type="tel" name="phone" value={form.phone} onChange={handleChange} placeholder="(905) 555-0100" required />
            </div>
          </div>
        </div>

        {/* ── ADDRESS ── */}
        <div className="form-section-card">
          <div className="form-section-header">
            <div className="form-section-icon navy">
              <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
            <div>
              <div className="form-section-heading">Home Address</div>
              <div className="form-section-heading-sub">Your current residential address</div>
            </div>
          </div>
          <div className="form-section-body">
            <div className="form-field span-2">
              <label className="form-label">Street Address <span className="form-label-required">*</span></label>
              <input className="form-input" name="street" value={form.street} onChange={handleChange} placeholder="123 Main Street, Apt 4B" required />
            </div>
            <div className="form-field">
              <label className="form-label">City <span className="form-label-required">*</span></label>
              <input className="form-input" name="city" value={form.city} onChange={handleChange} placeholder="Oakville" required />
            </div>
            <div className="form-field">
              <label className="form-label">Province <span className="form-label-required">*</span></label>
              <select className="form-input" name="province" value={form.province} onChange={handleChange} required>
                <option value="">Select province</option>
                <option>Ontario</option>
                <option>British Columbia</option>
                <option>Alberta</option>
                <option>Quebec</option>
                <option>Nova Scotia</option>
                <option>New Brunswick</option>
                <option>Manitoba</option>
                <option>Saskatchewan</option>
                <option>Newfoundland and Labrador</option>
                <option>Prince Edward Island</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Postal Code <span className="form-label-required">*</span></label>
              <input className="form-input" name="postalCode" value={form.postalCode} onChange={handleChange} placeholder="L6J 1A1" required />
            </div>
          </div>
        </div>

        {/* ── EMERGENCY CONTACT ── */}
        <div className="form-section-card">
          <div className="form-section-header">
            <div className="form-section-icon amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="1.8" strokeLinecap="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.22h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.18 6.18l.95-.96a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 21.73 16.92z"/>
              </svg>
            </div>
            <div>
              <div className="form-section-heading">Emergency Contact</div>
              <div className="form-section-heading-sub">Someone we can reach in case of an emergency</div>
            </div>
          </div>
          <div className="form-section-body">
            <div className="form-field">
              <label className="form-label">Full Name <span className="form-label-required">*</span></label>
              <input className="form-input" name="emergencyName" value={form.emergencyName} onChange={handleChange} placeholder="Jane Smith" required />
            </div>
            <div className="form-field">
              <label className="form-label">Relationship <span className="form-label-required">*</span></label>
              <select className="form-input" name="emergencyRelationship" value={form.emergencyRelationship} onChange={handleChange} required>
                <option value="">Select relationship</option>
                <option>Spouse / Partner</option>
                <option>Parent</option>
                <option>Sibling</option>
                <option>Child</option>
                <option>Friend</option>
                <option>Other</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Phone Number <span className="form-label-required">*</span></label>
              <input className="form-input" type="tel" name="emergencyPhone" value={form.emergencyPhone} onChange={handleChange} placeholder="(905) 555-0199" required />
            </div>
          </div>

          <div className="form-actions">
            <div className="form-save-note">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
              </svg>
              Progress saved automatically
            </div>
            <div className="form-action-btns">
              {saveError && <div className="login-error" style={{ marginBottom: 0 }}>{saveError}</div>}
              <button type="button" className="form-btn-secondary" onClick={() => router.push('/newhire/forms')}>
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
