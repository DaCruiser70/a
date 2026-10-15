'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import '../../../styles/pages/complete.css'
import { useMe } from '@/lib/use-me'
import { FORMS_HOME } from '@/lib/routes'

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

// Every required item on the checklist (Security Clearance is tracked separately and not listed)
const SUBMITTED_FORMS = [
  { name: 'Personal Information',     badge: 'Sent to HR' },
  { name: 'Banking & Direct Deposit', badge: 'Encrypted & sent to HR' },
  { name: 'Social Insurance Number',  badge: 'Encrypted & sent to HR' },
  { name: 'Policy Acknowledgement',   badge: 'Signed & sent to HR' },
  { name: 'Document Uploads',         badge: 'Sent to HR' },
]

const NEXT_STEPS = [
  {
    num: 1,
    title: 'HR reviews your forms',
    desc: 'A member of the HR team will review your forms and verify your information. If anything needs a fix, it will be marked on your checklist and you can resave it.',
    eta: 'Within 1–2 business days',
  },
  {
    num: 2,
    title: 'Payroll is set up',
    desc: 'Your banking and SIN details will be securely forwarded to the payroll team to set up your direct deposit.',
    eta: 'Before your first pay date',
  },
  {
    num: 3,
    title: 'You\'re ready to go',
    desc: 'Once HR approves your record, you\'ll receive a welcome email with everything you need for your first day.',
    eta: 'We\'ll be in touch',
  },
]

export default function CompletePage() {
  const router = useRouter()
  const { me } = useMe()
  const name = me?.name ?? ''
  const firstName = name.trim().split(/\s+/)[0] ?? ''

  // Only for hires who have sent every required form; anyone else goes back to the checklist
  useEffect(() => {
    let cancelled = false
    fetch('/api/newhire/status', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(data => { if (!cancelled && data && !data.submission?.complete) router.replace(FORMS_HOME) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [router])

  return (
    <div className="complete-page">

      {/* ── NAV ── */}
      <nav className="complete-nav">
        <div className="complete-nav-left">
          <Image src="/logo.png" alt="AEM" width={120} height={32} className="complete-nav-logo" />
          <div className="complete-nav-div" />
          <span className="complete-nav-label">Employee Onboarding Portal</span>
        </div>
        <div className="complete-nav-right">
          <div className="complete-nav-user">
            <div className="complete-nav-avatar" aria-hidden="true">{name ? getInitials(name) : '…'}</div>
            {name && <span className="complete-nav-name">{name}</span>}
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div className="complete-hero">
        <div className="complete-hero-orb-1" />
        <div className="complete-hero-orb-2" />

        <div className="complete-hero-inner">

          {/* Animated check */}
          <div className="complete-check-wrap" aria-hidden="true">
            <div className="complete-check-ring" />
            <div className="complete-check-ring-2" />
            <div className="complete-check-ring-3" />
            <div className="complete-check-circle">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
          </div>

          <div className="complete-hero-tag">
            <div className="complete-hero-tag-dot" />
            All forms received
          </div>

          <h1 className="complete-hero-title">
            {firstName ? <>You&apos;re all set,<br /><em>{firstName}.</em></> : <>You&apos;re all set.</>}
          </h1>

          <p className="complete-hero-sub">
            All required forms have been sent to HR securely.
            The HR team has been notified and will be in touch shortly.
          </p>

        </div>
      </div>

      {/* ── BODY ── */}
      <div className="complete-body">

        {/* Forms sent */}
        <div className="complete-card">
          <div className="complete-card-header">
            <div className="complete-card-icon green">
              <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="1.8" strokeLinecap="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <div>
              <div className="complete-card-heading">Forms Received</div>
              <div className="complete-card-sub">All required forms received — sensitive details encrypted, files stored privately</div>
            </div>
          </div>

          <div className="complete-forms-list">
            {SUBMITTED_FORMS.map((form) => (
              <div key={form.name} className="complete-form-item">
                <div className="complete-form-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </div>
                <div>
                  <div className="complete-form-name">{form.name}</div>
                  <div className="complete-form-badge">{form.badge}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* What happens next */}
        <div className="complete-card">
          <div className="complete-card-header">
            <div className="complete-card-icon navy">
              <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div>
              <div className="complete-card-heading">What Happens Next</div>
              <div className="complete-card-sub">Here&apos;s what to expect over the coming days</div>
            </div>
          </div>

          <div className="complete-steps">
            {NEXT_STEPS.map((step) => (
              <div key={step.num} className="complete-step">
                <div className="complete-step-num">{step.num}</div>
                <div className="complete-step-body">
                  <div className="complete-step-title">{step.title}</div>
                  <div className="complete-step-desc">{step.desc}</div>
                  <div className="complete-step-eta">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    {step.eta}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Contact card */}
        <div className="complete-card">
          <div className="complete-card-header">
            <div className="complete-card-icon amber">
              <svg viewBox="0 0 24 24" fill="none" stroke="#C8920A" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
            </div>
            <div>
              <div className="complete-card-heading">Questions?</div>
              <div className="complete-card-sub">Our HR team is happy to help</div>
            </div>
          </div>
          <div style={{ padding: '1.5rem 1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '14px', color: '#5F5E5A', lineHeight: 1.6 }}>
              If you have any questions about your forms or need to make a correction,
              reach out to the HR team directly.
            </div>
            <a
              href="mailto:hr@aemltd.com"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                padding: '10px 20px',
                background: 'rgba(27,58,107,0.06)',
                border: '1px solid rgba(27,58,107,0.15)',
                borderRadius: '10px',
                fontSize: '13px', fontWeight: 600, color: '#1B3A6B',
                textDecoration: 'none', whiteSpace: 'nowrap',
                transition: 'background 0.2s',
                fontFamily: 'var(--font-sans)',
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: '14px', height: '14px' }}>
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              hr@aemltd.com
            </a>
          </div>
        </div>

        {/* CTA banner */}
        <div className="complete-cta">
          <div className="complete-cta-text">
            <h3>You&apos;re officially part of the team.</h3>
            <p>
              Welcome to Advanced Energy Management Ltd. We&apos;re building something great
              and we&apos;re glad you&apos;re here to be part of it.
            </p>
          </div>
          <Link href={FORMS_HOME} className="complete-cta-btn">
            Back to my checklist
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: '14px', height: '14px' }}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </Link>
        </div>

      </div>
    </div>
  )
}
