import Image from 'next/image'
import Typewriter from '../../../components/ui/Typewriter'
import LoginWires from '../../../components/ui/LoginWires'
import LoginForm from '../../../components/ui/LoginForm'
import { staffPasswordLoginOn } from '@/lib/microsoft-auth'
import '../../../styles/pages/login-daylight.css'

// "Daylight Circuit". Presentation only: sign-in itself is LoginForm and /api/auth/*, unchanged.

const VALUES = [
  { tone: 'green', name: 'Safety First', desc: 'Nothing matters more than going home safe.' },
  { tone: 'blue',  name: 'Innovation',   desc: 'Smarter solutions for a sustainable future.' },
  { tone: 'amber', name: 'Excellence',   desc: 'The highest standard in our work and results.' },
] as const

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ otp_required?: string | string[]; ms?: string | string[] }>
}) {
  const { otp_required, ms } = await searchParams
  const otpRequired = otp_required === '1'
  // Microsoft sign-in: off until NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED is 'true'
  const microsoftEnabled   = process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED === 'true'
  // Server-only setting; only whether it is on reaches the browser
  const staffPasswordLogin = staffPasswordLoginOn(process.env.STAFF_PASSWORD_LOGIN)
  // Back from a refused Microsoft sign-in: one fixed message, never the reason
  const microsoftRefused   = microsoftEnabled && ms === 'refused'

  return (
    <main className="ld-page">
      <LoginWires />

      <header className="ld-brand" data-ld-logo>
        <span className="ld-logo-pill">
          <Image src="/logo.png" alt="Advanced Energy Management" width={925} height={356} priority className="ld-logo-img" />
        </span>
        <span className="ld-brand-label">Employee Onboarding</span>
      </header>

      <div className="ld-layout">
        <h1 className="ld-sr-only">Your first day starts here.</h1>

        {/* The card comes first: first on phones, and first in the keyboard order */}
        <div className="ld-card-wrap">
          <div className="ld-card-glow" aria-hidden="true" />
          <div className="ld-ripple ld-ripple-1" aria-hidden="true" />
          <div className="ld-ripple ld-ripple-2" aria-hidden="true" />
          <div className="ld-ripple ld-ripple-3" aria-hidden="true" />
          <div className="ld-card" data-ld-card>
            <LoginForm otpRequired={otpRequired} microsoftEnabled={microsoftEnabled}
              staffPasswordLogin={staffPasswordLogin} microsoftRefused={microsoftRefused} />
          </div>
        </div>

        <section className="ld-left" data-ld-left aria-label="About the portal">
          <div className="ld-intro">
            <Typewriter />
            <p className="ld-sub">
              Sign in with your email and the password you set. First time here? Use the link in your
              welcome email. Everything you need to get started is waiting inside.
            </p>
          </div>

          {/* The wires cross the open space between the paragraph and these cards */}
          <ul className="ld-values" aria-label="Our values">
            {VALUES.map(v => (
              <li key={v.name} className={`ld-value ld-value-${v.tone}`}>
                <span className="ld-value-dot" aria-hidden="true" />
                <span className="ld-value-name">{v.name}</span>
                <span className="ld-value-desc">{v.desc}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="ld-foot">Access by invitation only. Contact HR if you need help.</footer>
    </main>
  )
}
