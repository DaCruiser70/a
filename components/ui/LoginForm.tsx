'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const OTP_EXPIRY = 300

// Error bodies are JSON from our routes, but a proxy or crash page may not be
async function readJson(res: Response): Promise<{ error?: string; [key: string]: unknown }> {
  try { return await res.json() } catch { return {} }
}

export default function LoginForm({ otpRequired = false }: { otpRequired?: boolean }) {
  const router = useRouter()
  const supabase = createClient()

  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [stage, setStage]           = useState<'login' | 'otp'>('login')
  const [otp, setOtp]               = useState(['', '', '', '', '', ''])
  const [otpError, setOtpError]     = useState('')
  const [otpLoading, setOtpLoading] = useState(false)
  const [timeLeft, setTimeLeft]     = useState(OTP_EXPIRY)
  const [canResend, setCanResend]   = useState(false)
  const [devOtp, setDevOtp]         = useState<string | null>(null)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (stage !== 'otp') return
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(interval); setCanResend(true); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [stage])

  function formatTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  async function handleLogin(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    let res: Response
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
      setLoading(false)
      return
    }
    const data = await readJson(res)

    if (!res.ok) {
      setError(data.error || 'Sign in failed.')
      setLoading(false)
      return
    }

    if (data.role === 'newhire') {
      // Set the session in the Supabase client
      const session = data.session as { access_token: string; refresh_token: string }
      await supabase.auth.setSession({
        access_token:  session.access_token,
        refresh_token: session.refresh_token,
      })
      router.push('/newhire/welcome')
      return
    }

    // Everyone else: show OTP screen
    setDevOtp(typeof data.devCode === 'string' ? data.devCode : null)
    setTimeLeft(OTP_EXPIRY)
    setCanResend(false)
    setOtp(['', '', '', '', '', ''])
    setOtpError('')
    setStage('otp')
    setLoading(false)
  }

  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...otp]
    next[index] = digit
    setOtp(next)
    setOtpError('')
    if (digit && index < 5) otpRefs.current[index + 1]?.focus()
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  function handleOtpPaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (pasted.length === 6) {
      setOtp(pasted.split(''))
      otpRefs.current[5]?.focus()
    }
  }

  async function handleOtpSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    const code = otp.join('')
    if (code.length < 6) { setOtpError('Please enter the full 6-digit code.'); return }
    setOtpLoading(true)

    let res: Response
    try {
      res = await fetch('/api/auth/otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
    } catch {
      setOtpError('Could not reach the server. Check your connection and try again.')
      setOtpLoading(false)
      return
    }
    const data = await readJson(res)

    if (res.status === 401) {
      // The pending sign-in is gone — start over from the password step
      handleBackToLogin()
      setError(data.error || 'Session expired. Please sign in again.')
      setOtpLoading(false)
      return
    }

    if (!res.ok) {
      setOtpError(data.error || 'Verification failed.')
      setOtp(['', '', '', '', '', ''])
      otpRefs.current[0]?.focus()
      setOtpLoading(false)
      return
    }

    // Session was set server-side by the OTP route; give the browser 100ms to
    // receive the Set-Cookie headers before navigating.
    setTimeout(() => { window.location.href = '/hr/dashboard' }, 100)
  }

  async function handleResend() {
    setOtp(['', '', '', '', '', ''])
    setOtpError('')
    setDevOtp(null)

    let res: Response
    try {
      res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch {
      setOtpError('Could not reach the server. Check your connection and try again.')
      return
    }
    const data = await readJson(res)
    if (!res.ok) {
      setOtpError(data.error || 'Could not send a new code.')
      return
    }
    if (typeof data.devCode === 'string') setDevOtp(data.devCode)

    setTimeLeft(OTP_EXPIRY)
    setCanResend(false)
  }

  function handleBackToLogin() {
    setStage('login')
    setOtp(['', '', '', '', '', ''])
    setOtpError('')
    setDevOtp(null)
  }

  /* ── OTP SCREEN ── */
  if (stage === 'otp') {
    return (
      <>
        <div className="login-card-body">
          <div className="login-icon-stage">
            <div className="login-icon-glow" />
            <div
              className="login-icon-core"
              style={{
                fontSize: '24px',
                background: 'linear-gradient(135deg, rgba(27,58,107,0.3), rgba(27,58,107,0.5))',
                borderColor: 'rgba(200,146,10,0.5)',
              }}
            >
              <div className="login-icon-shimmer" />
              🔐
            </div>
          </div>

          <div className="login-card-title">Verify your identity</div>
          <div className="login-card-sub">
            A 6-digit code was sent to the email address<br />
            registered to your account
          </div>

          <form onSubmit={handleOtpSubmit}>
            <div className="otp-input-row" onPaste={handleOtpPaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el }}
                  className={`otp-digit${otpError ? ' otp-digit-error' : ''}`}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(i, e)}
                  autoFocus={i === 0}
                />
              ))}
            </div>

            {otpError && <div className="login-error" role="alert">{otpError}</div>}

            <div className="otp-timer">
              {canResend ? (
                <button type="button" className="otp-resend-btn" onClick={handleResend}>
                  Resend code →
                </button>
              ) : (
                <span>
                  Code expires in <strong style={{ color: '#E8B84B' }}>{formatTime(timeLeft)}</strong>
                </span>
              )}
            </div>

            <button
              type="submit"
              className="login-btn"
              disabled={otpLoading || otp.join('').length < 6}
              style={{ opacity: otp.join('').length < 6 ? 0.6 : 1 }}
            >
              <span className="login-btn-text">{otpLoading ? 'Verifying...' : 'Verify & Sign In'}</span>
              <span className="login-btn-arrow">{otpLoading ? '...' : '→'}</span>
            </button>
          </form>

          {devOtp && (
            <div className="otp-hint">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                style={{ width: '12px', height: '12px', flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Dev mode — code: <strong style={{ color: '#E8B84B' }}>{devOtp}</strong>
            </div>
          )}
        </div>

        <div className="login-card-foot">
          <span style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }} onClick={handleBackToLogin}>
            ← Back to sign in
          </span>
        </div>
      </>
    )
  }

  /* ── LOGIN SCREEN ── */
  return (
    <>
      <div className="login-card-body">
        <div className="login-icon-stage">
          <div className="login-orbit login-orbit-a"><div className="login-odot" /></div>
          <div className="login-orbit login-orbit-b"><div className="login-odot" /></div>
          <div className="login-orbit login-orbit-c">
            <div className="login-odot" />
            <div className="login-odot-2" />
          </div>
          <div className="login-icon-glow" />
          <div className="login-icon-core">
            <div className="login-icon-shimmer" />
            A
          </div>
        </div>

        <div className="login-card-title">Welcome back</div>
        <div className="login-card-sub">Use the credentials sent to your email</div>

        {otpRequired && !error && (
          <div className="login-notice" role="status">Please sign in again to continue</div>
        )}

        <form onSubmit={handleLogin}>
          <div className="login-field">
            <label htmlFor="username">Email</label>
            <div className="login-inp-wrap">
              <span className="login-inp-icon">@</span>
              <input
                type="email" id="username"
                placeholder="your.name@aemltd.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="login-field">
            <label htmlFor="password">Password</label>
            <div className="login-inp-wrap">
              <span className="login-inp-icon">•••</span>
              <input
                type="password" id="password"
                placeholder="Your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {error && <div className="login-error" role="alert">{error}</div>}

          <button type="submit" className="login-btn" disabled={loading}>
            <span className="login-btn-text">{loading ? 'Signing in...' : 'Sign in to Portal'}</span>
            <span className="login-btn-arrow">{loading ? '...' : '→'}</span>
          </button>
        </form>

        <div className="login-help">
          Need help? <a href="mailto:hr@aemltd.com">hr@aemltd.com</a>
        </div>
      </div>

      <div className="login-card-foot">
        HR staff — sign in with your <strong>@aemltd.com</strong> account
      </div>
    </>
  )
}
