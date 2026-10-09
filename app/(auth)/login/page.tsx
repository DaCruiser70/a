import Typewriter from '../../../components/ui/Typewriter'
import StarField from '../../../components/ui/StarField'
import LoginForm from '../../../components/ui/LoginForm'
import '../../../styles/pages/login.css'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ otp_required?: string | string[] }>
}) {
  const { otp_required } = await searchParams
  const otpRequired = otp_required === '1'

  return (
    <main className="login-page">

      <div className="login-bg">
        <div className="login-bg-stars" id="login-stars" />
        <div className="login-bg-grid" />
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />
        <div className="login-orb login-orb-4" />
        <div className="login-orb login-orb-5" />
        <div className="login-orb login-orb-6" />
        <div className="login-particles">
          <div className="login-particle" />
          <div className="login-particle" />
          <div className="login-particle" />
          <div className="login-particle" />
          <div className="login-particle" />
          <div className="login-particle" />
        </div>
      </div>
      <StarField />

      <div className="login-wrapper">

        {/* ── LEFT ── */}
        <div className="login-left">
          <div className="login-left-top">
            <div className="login-brand">
              <div className="login-brand-logo">AEM</div>
              <div className="login-brand-sep" />
              <div className="login-brand-label">Employee Onboarding</div>
            </div>
            <div className="login-headline">
              <div className="login-tag">
                <div className="login-tag-dot" />
                New Hire Portal
              </div>
              <h1>
                Your first day<br />
                <span className="login-tw-wrap"><Typewriter /></span>
              </h1>
              <div className="login-gold-line" />
              <p className="login-sub">
                Sign in with the credentials sent to your email.
                Everything you need to get started is waiting inside.
              </p>
            </div>
          </div>

          <div className="login-left-mid">
            <div className="login-values-label">Our values</div>
            <div className="login-values">

              <div className="login-value-card value-safety">
                <div className="login-value-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="rgba(13,200,120,0.85)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
                <div className="login-value-text">
                  <div className="login-value-name">Safety First</div>
                  <div className="login-value-desc">Every decision, every site, every day — nothing matters more than going home safe.</div>
                </div>
                <div className="login-value-arrow">→</div>
              </div>

              <div className="login-value-card value-innovation">
                <div className="login-value-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="rgba(200,146,10,0.9)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
                  </svg>
                </div>
                <div className="login-value-text">
                  <div className="login-value-name">Innovation</div>
                  <div className="login-value-desc">We push boundaries in energy management, building smarter solutions for a sustainable future.</div>
                </div>
                <div className="login-value-arrow">→</div>
              </div>

              <div className="login-value-card value-excellence">
                <div className="login-value-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="rgba(168,85,247,0.9)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </div>
                <div className="login-value-text">
                  <div className="login-value-name">Excellence</div>
                  <div className="login-value-desc">We hold ourselves to the highest standard — in our work, our relationships, and our results.</div>
                </div>
                <div className="login-value-arrow">→</div>
              </div>

            </div>
          </div>

          <div className="login-footer-note">
            Access by invitation only · Contact HR if you need help
          </div>
        </div>

        {/* ── RIGHT ── */}
        <div className="login-right">
          <div className="login-card">
            <div className="login-card-bar">
              <div className="login-bar-dots">
                <div className="login-bar-dot" />
                <div className="login-bar-dot" />
                <div className="login-bar-dot" />
              </div>
              <div className="login-bar-url">aem-onboarding.portal</div>
              <div className="login-bar-lock">🔒</div>
            </div>
            <LoginForm otpRequired={otpRequired} />
          </div>
        </div>

      </div>
    </main>
  )
}