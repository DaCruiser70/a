import type { Metadata } from 'next'
import SetPasswordForm from '../../../components/ui/SetPasswordForm'
import '../../../styles/pages/login.css'
import '../../../styles/pages/set-password.css'

// Where a welcome or reset email's link lands. Open to signed-out visitors (middleware.ts).
// Response headers (no-referrer, no-store, noindex) are set in next.config.ts.
export const metadata: Metadata = {
  title:    'Set your password · AEM Onboarding',
  referrer: 'no-referrer',
  robots:   { index: false, follow: false },
}

export default function SetPasswordPage() {
  return (
    <main className="login-page">
      <div className="login-bg" aria-hidden="true">
        <div className="login-bg-grid" />
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />
      </div>

      <div className="login-wrapper">
        <div className="login-right sp-right">
          <div className="sp-column">
            <div className="login-brand sp-brand">
              <div className="login-brand-logo">AEM</div>
              <div className="login-brand-sep" />
              <div className="login-brand-label">Employee Onboarding</div>
            </div>
            <div className="login-card">
              <SetPasswordForm />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
