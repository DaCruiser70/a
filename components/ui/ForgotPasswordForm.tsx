'use client'

import { useEffect, useRef, useState } from 'react'

// "Send me a new link": the login page's "Forgot password?" and an expired /set-password link.
// The server answers the same way whether or not the email has an account, and so does this form.

export default function ForgotPasswordForm({ title, intro, initialEmail = '' }: {
  title:         string
  intro:         string
  initialEmail?: string
}) {
  const [email, setEmail]     = useState(initialEmail)
  const [error, setError]     = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const titleRef = useRef<HTMLDivElement>(null)

  // This form replaces whatever was on screen: move focus to its heading so it is announced
  useEffect(() => { titleRef.current?.focus() }, [])

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setError('')
    setMessage('')
    if (!email.trim()) { setError('Please enter your email address.'); return }
    setLoading(true)
    try {
      const res  = await fetch('/api/auth/password/forgot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; message?: string }
      if (!res.ok) { setError(body.error ?? 'Something went wrong. Please try again in a minute.'); return }
      setMessage(body.message ?? 'If that email belongs to an account, we have sent a link.')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="login-card-title" tabIndex={-1} ref={titleRef}>{title}</div>
      <div className="login-card-sub">{intro}</div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="login-field">
          <label htmlFor="forgot-email">Email</label>
          <div className="login-inp-wrap">
            <span className="login-inp-icon" aria-hidden="true">@</span>
            <input
              type="email" id="forgot-email" autoComplete="email" maxLength={254}
              placeholder="your.name@aemltd.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'forgot-error' : undefined}
              required
            />
          </div>
        </div>

        <div aria-live="polite">
          {error && <div id="forgot-error" className="login-error" role="alert">{error}</div>}
          {message && <div className="login-notice" role="status">{message}</div>}
        </div>

        <button type="submit" className="login-btn" disabled={loading}>
          <span className="login-btn-text">{loading ? 'Sending…' : message ? 'Send again' : 'Send me a link'}</span>
          <span className="login-btn-arrow" aria-hidden="true">{loading ? '...' : '→'}</span>
        </button>
      </form>
    </>
  )
}
