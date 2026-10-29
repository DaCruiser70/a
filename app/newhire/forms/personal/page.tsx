'use client'

import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { useState, useEffect } from 'react'
import '../../../../styles/pages/form-pages.css'
import { createClient } from '@/lib/supabase/client'
import { FORMS_HOME, COMPLETE_PAGE } from '@/lib/routes'
import {
  PROVINCES, EMERGENCY_RELATIONSHIPS, PHONE_CHOICES, PHONE_CHOICE_LABELS, WORK_PHONE_PLATFORMS,
  WORK_PHONE_PLATFORM_LABELS, PHONE_MAX, DOB_EARLIEST, DOB_MIN_AGE, dobLatest, dobError, phoneError,
  type PhoneChoice, type WorkPhonePlatform,
} from '@/lib/personal-info'

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

const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message ? <span id={id} className="form-field-error" role="alert">{message}</span> : null

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
  // Phone setup: only the chosen branch keeps an answer
  const [phoneChoice, setPhoneChoice]     = useState<PhoneChoice | ''>('')
  const [workPlatform, setWorkPlatform]   = useState<WorkPhonePlatform | ''>('')
  const [personalPhone, setPersonalPhone] = useState('')
  const [fieldErrors, setFieldErrors]     = useState<Record<string, string>>({})
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
      // personal_info is encrypted at rest — read it through the API, never directly from the browser
      const [personalRes, { data: profile }, sourcesRes] = await Promise.all([
        fetch('/api/forms/personal').then(r => r.ok ? r.json() : null).catch(() => null),
        supabase.from('profiles').select('full_name').eq('id', user.id).single(),
        fetch('/api/newhire/flag-sources').then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      if (profile?.full_name) setUserName(profile.full_name)
      if (sourcesRes?.sources?.personal) setFlagSource(sourcesRes.sources.personal)
      const data = personalRes?.existing
      if (!data) return
      setForm({
        firstName:             data.firstName             ?? '',
        lastName:              data.lastName              ?? '',
        dateOfBirth:           data.dateOfBirth           ?? '',
        phone:                 data.phone                 ?? '',
        email:                 data.email                 ?? '',
        street:                data.street                ?? '',
        city:                  data.city                  ?? '',
        province:              data.province              ?? '',
        postalCode:            data.postalCode            ?? '',
        emergencyName:         data.emergencyName         ?? '',
        emergencyRelationship: data.emergencyRelationship ?? '',
        emergencyPhone:        data.emergencyPhone        ?? '',
      })
      setPhoneChoice(data.phoneChoice ?? '')
      setWorkPlatform(data.workPhonePlatform ?? '')
      setPersonalPhone(data.personalPhone ?? '')
      setFormStatus(data.formStatus ?? '')
      setFlagReason(data.flagReason ?? null)
    }).catch(() => {})
  }, [])

  function handleChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setForm(prev => ({ ...prev, [name]: value }))
    setFieldErrors(prev => (prev[name] ? { ...prev, [name]: '' } : prev))
  }

  // Switching clears the other branch's answer; the personal number starts from Phone
  function choosePhone(choice: PhoneChoice) {
    if (choice === phoneChoice) return
    setPhoneChoice(choice)
    setWorkPlatform('')
    setPersonalPhone(choice === 'personal' ? form.phone : '')
    setFieldErrors(prev => ({ ...prev, phoneChoice: '', workPhonePlatform: '', personalPhone: '' }))
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {}
    const dob = dobError(form.dateOfBirth)
    if (dob) errors.dateOfBirth = dob
    const phone = form.phone.trim() && phoneError(form.phone)
    if (phone) errors.phone = phone
    const emergency = form.emergencyPhone.trim() && phoneError(form.emergencyPhone)
    if (emergency) errors.emergencyPhone = emergency
    if (!phoneChoice) errors.phoneChoice = 'Choose a company work phone or your personal phone.'
    if (phoneChoice === 'work' && !workPlatform) errors.workPhonePlatform = 'Choose Apple or Android.'
    if (phoneChoice === 'personal') {
      const personal = phoneError(personalPhone)
      if (personal) errors.personalPhone = personal
    }
    return errors
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    const errors = validate()
    setFieldErrors(errors)
    const first = Object.keys(errors)[0]
    if (first) {
      setSaveError('Please fix the highlighted answers.')
      // Radio groups focus their first option
      const target = first === 'phoneChoice' ? 'pi-phone-work' : first === 'workPhonePlatform' ? 'pi-platform-apple' : `pi-${first}`
      document.getElementById(target)?.focus()
      return
    }
    setSaving(true)
    setSaveError('')
    const res = await fetch('/api/forms/personal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        phoneChoice,
        workPhonePlatform: phoneChoice === 'work' ? workPlatform || null : null,
        personalPhone:     phoneChoice === 'personal' ? personalPhone : null,
      }),
    }).catch(() => null)
    if (!res) {
      setSaveError('Could not reach the server. Check your connection and try again.')
      setSaving(false)
      return
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setSaveError(data.error ?? 'Failed to save. Please try again.')
      setSaving(false)
      return
    }
    const saved = await res.json().catch(() => ({}))
    // replace, so the browser Back button doesn't return to the submitted form;
    // the save that sends the last required form goes to the confirmation page
    router.replace(saved.justCompleted ? COMPLETE_PAGE : FORMS_HOME)
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
              <label className="form-label" htmlFor="pi-dateOfBirth">
                Date of Birth <span className="form-label-required">*</span><span className="form-label-encrypted">Encrypted</span>
              </label>
              <input
                id="pi-dateOfBirth" className="form-input" type="date" name="dateOfBirth"
                value={form.dateOfBirth} onChange={handleChange} required
                min={DOB_EARLIEST} max={dobLatest()} suppressHydrationWarning
                aria-invalid={!!fieldErrors.dateOfBirth || undefined}
                aria-describedby={fieldErrors.dateOfBirth ? 'pi-dateOfBirth-error pi-dateOfBirth-hint' : 'pi-dateOfBirth-hint'}
              />
              <span id="pi-dateOfBirth-hint" className="form-input-hint">You must be at least {DOB_MIN_AGE}. HR sees it only after a security check.</span>
              <FieldError id="pi-dateOfBirth-error" message={fieldErrors.dateOfBirth} />
            </div>
            <div className="form-field">
              <label className="form-label">Personal Email <span className="form-label-required">*</span></label>
              <input className="form-input" type="email" name="email" value={form.email} onChange={handleChange} placeholder="john@email.com" required />
              <span className="form-input-hint">Your personal email — not your AEM address</span>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="pi-phone">Phone Number <span className="form-label-required">*</span></label>
              <input
                id="pi-phone" className="form-input" type="tel" name="phone" value={form.phone} onChange={handleChange}
                placeholder="(905) 555-0100" required maxLength={PHONE_MAX} autoComplete="tel"
                aria-invalid={!!fieldErrors.phone || undefined} aria-describedby={fieldErrors.phone ? 'pi-phone-error' : undefined}
              />
              <FieldError id="pi-phone-error" message={fieldErrors.phone} />
            </div>
          </div>
        </div>

        {/* ── PHONE SETUP ── */}
        <div className="form-section-card">
          <div className="form-section-header">
            <div className="form-section-icon navy">
              <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
            </div>
            <div>
              <div className="form-section-heading">Phone</div>
              <div className="form-section-heading-sub">The phone you will use for work</div>
            </div>
          </div>
          <div className="form-section-body single-col">
            <fieldset className="form-choice-fieldset" aria-describedby={fieldErrors.phoneChoice ? 'pi-phoneChoice-error' : undefined}>
              <legend className="form-label">
                Do you want a company work phone, or will you use your personal phone? <span className="form-label-required">*</span>
              </legend>
              <div className="form-choice-group">
                {PHONE_CHOICES.map(c => (
                  <label key={c} className={`form-choice${phoneChoice === c ? ' selected' : ''}`} htmlFor={`pi-phone-${c}`}>
                    <input
                      id={`pi-phone-${c}`} type="radio" name="phoneChoice" value={c}
                      checked={phoneChoice === c} onChange={() => choosePhone(c)}
                    />
                    {PHONE_CHOICE_LABELS[c]}
                  </label>
                ))}
              </div>
              <FieldError id="pi-phoneChoice-error" message={fieldErrors.phoneChoice} />
            </fieldset>

            {phoneChoice === 'work' && (
              <fieldset className="form-choice-fieldset" aria-describedby={fieldErrors.workPhonePlatform ? 'pi-workPhonePlatform-error' : undefined}>
                <legend className="form-label">Apple or Android? <span className="form-label-required">*</span></legend>
                <div className="form-choice-group">
                  {WORK_PHONE_PLATFORMS.map(p => (
                    <label key={p} className={`form-choice${workPlatform === p ? ' selected' : ''}`} htmlFor={`pi-platform-${p}`}>
                      <input
                        id={`pi-platform-${p}`} type="radio" name="workPhonePlatform" value={p}
                        checked={workPlatform === p}
                        onChange={() => { setWorkPlatform(p); setFieldErrors(prev => ({ ...prev, workPhonePlatform: '' })) }}
                      />
                      {WORK_PHONE_PLATFORM_LABELS[p]}
                    </label>
                  ))}
                </div>
                <FieldError id="pi-workPhonePlatform-error" message={fieldErrors.workPhonePlatform} />
              </fieldset>
            )}

            {phoneChoice === 'personal' && (
              <div className="form-field">
                <label className="form-label" htmlFor="pi-personalPhone">
                  Personal phone number <span className="form-label-required">*</span><span className="form-label-encrypted">Encrypted</span>
                </label>
                <input
                  id="pi-personalPhone" className="form-input" type="tel" value={personalPhone}
                  onChange={e => { setPersonalPhone(e.target.value); setFieldErrors(prev => ({ ...prev, personalPhone: '' })) }}
                  placeholder="(905) 555-0100" required maxLength={PHONE_MAX} autoComplete="tel"
                  aria-invalid={!!fieldErrors.personalPhone || undefined}
                  aria-describedby={fieldErrors.personalPhone ? 'pi-personalPhone-error pi-personalPhone-hint' : 'pi-personalPhone-hint'}
                />
                <span id="pi-personalPhone-hint" className="form-input-hint">Filled in from your phone number above. Change it if you use a different phone for work.</span>
                <FieldError id="pi-personalPhone-error" message={fieldErrors.personalPhone} />
              </div>
            )}
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
                {PROVINCES.map(p => <option key={p}>{p}</option>)}
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
                {EMERGENCY_RELATIONSHIPS.map(r => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="pi-emergencyPhone">Phone Number <span className="form-label-required">*</span></label>
              <input
                id="pi-emergencyPhone" className="form-input" type="tel" name="emergencyPhone" value={form.emergencyPhone} onChange={handleChange}
                placeholder="(905) 555-0199" required maxLength={PHONE_MAX}
                aria-invalid={!!fieldErrors.emergencyPhone || undefined} aria-describedby={fieldErrors.emergencyPhone ? 'pi-emergencyPhone-error' : undefined}
              />
              <FieldError id="pi-emergencyPhone-error" message={fieldErrors.emergencyPhone} />
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
              {saveError && <div className="login-error" role="alert" style={{ marginBottom: 0 }}>{saveError}</div>}
              <button type="button" className="form-btn-secondary" onClick={() => router.push(FORMS_HOME)}>
                ← Back
              </button>
              <button type="submit" className="form-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : formStatus === 'flagged' ? 'Resubmit for review →' : 'Save & return to checklist →'}
              </button>
            </div>
          </div>
        </div>

      </form>
    </div>
  )
}
