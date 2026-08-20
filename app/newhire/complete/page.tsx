import Image from 'next/image'
import Link from 'next/link'
import '../../../styles/pages/complete.css'

export default function CompletePage() {
  const submittedAt = new Date().toLocaleDateString('en-CA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const SUBMITTED_FORMS = [
    { name: 'Personal Information', badge: 'Submitted' },
    { name: 'Banking & Direct Deposit', badge: 'Encrypted & Submitted' },
    { name: 'Social Insurance Number', badge: 'Encrypted & Submitted' },
    { name: 'Policy Acknowledgement', badge: 'Signed & Submitted' },
  ]

  const NEXT_STEPS = [
    {
      num: 1,
      title: 'HR reviews your submission',
      desc: 'A member of the HR team will review your submitted forms and verify your information. You will receive an email confirmation shortly.',
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
            <div className="complete-nav-avatar">LD</div>
            <span className="complete-nav-name">Lucas DaCruz</span>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div className="complete-hero">
        <div className="complete-hero-orb-1" />
        <div className="complete-hero-orb-2" />

        <div className="complete-hero-inner">

          {/* Animated check */}
          <div className="complete-check-wrap">
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
            Onboarding Complete
          </div>

          <h1 className="complete-hero-title">
            You&apos;re all set,<br /><em>Lucas.</em>
          </h1>

          <p className="complete-hero-sub">
            All four forms have been submitted successfully and securely.
            The HR team has been notified and will be in touch shortly.
          </p>

          <div className="complete-hero-timestamp">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Submitted {submittedAt}
          </div>

        </div>
      </div>

      {/* ── BODY ── */}
      <div className="complete-body">

        {/* Forms submitted */}
        <div className="complete-card">
          <div className="complete-card-header">
            <div className="complete-card-icon green">
              <svg viewBox="0 0 24 24" fill="none" stroke="#0D5C46" strokeWidth="1.8" strokeLinecap="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <div>
              <div className="complete-card-heading">Forms Submitted</div>
              <div className="complete-card-sub">All four forms received — encrypted and stored securely</div>
            </div>
          </div>

          <div className="complete-forms-list">
            {SUBMITTED_FORMS.map((form) => (
              <div key={form.name} className="complete-form-item">
                <div className="complete-form-check">
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
              If you have any questions about your submission or need to make a correction,<br />
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
          <Link href="/newhire/welcome" className="complete-cta-btn">
            Back to welcome
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ width: '14px', height: '14px' }}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </Link>
        </div>

      </div>
    </div>
  )
}