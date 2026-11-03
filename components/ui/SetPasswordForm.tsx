'use client'

import { useEffect, useRef, useState } from 'react'
import ForgotPasswordForm from '@/components/ui/ForgotPasswordForm'
import {
  PASSWORD_MAX, STRENGTH_LABELS, passwordChecklist, passwordError, passwordStrength,
} from '@/lib/password-rules'

// /set-password. The token is read once from the address (#token=…), removed from the address bar
// straight away, kept only in memory, and sent to the server by POST. It is never put in a link,
// stored, or logged. The account is not signed in here: the person signs in afterwards.

type Stage = 'checking' | 'form' | 'done' | 'invalid' | 'forgot'

const LINK_INVALID = 'This link has expired or was already used.'

function readToken(): string | null {
  const fromHash  = new URLSearchParams(window.location.hash.slice(1)).get('token')
  const fromQuery = new URLSearchParams(window.location.search).get('token')
  const token = fromHash ?? fromQuery
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null
}

export default function SetPasswordForm() {
  const tokenRef = useRef<string | null>(null)
  const readRef  = useRef(false)
  const headingRef = useRef<HTMLDivElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const [stage, setStage]         = useState<Stage>('checking')
  const [emailName, setEmailName] = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm]   = useState(false)
  const [error, setError]         = useState('')
  const [checkError, setCheckError] = useState('')
  const [saving, setSaving]       = useState(false)
  const [attempt, setAttempt]     = useState(0)

  // Read the token once (React may run this effect twice in development), then clear the address bar
  useEffect(() => {
    if (!readRef.current) {
      readRef.current  = true
      tokenRef.current = readToken()
      window.history.replaceState(null, '', window.location.pathname)
    }
    const token = tokenRef.current
    if (!token) { setStage('invalid'); return }

    let cancelled = false
    setCheckError('')
    fetch('/api/auth/password/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
    })
      .then(async res => {
        const body = await res.json().catch(() => ({})) as { emailName?: string; error?: string }
        if (cancelled) return
        if (res.ok) { setEmailName(body.emailName ?? ''); setStage('form'); return }
        if (res.status === 410 || res.status === 400) { setStage('invalid'); return }
        setCheckError(body.error ?? 'Something went wrong. Please try again in a minute.')
      })
      .catch(() => { if (!cancelled) setCheckError('Could not reach the server. Check your connection and try again.') })
    return () => { cancelled = true }
  }, [attempt])

  // Each new screen is announced: focus moves to its heading
  useEffect(() => {
    if (stage === 'done' || stage === 'invalid') headingRef.current?.focus()
    if (stage === 'form') passwordRef.current?.focus()
  }, [stage])

  // Leaving the page drops the token from memory
  useEffect(() => {
    const clear = () => { tokenRef.current = null }
    window.addEventListener('pagehide', clear)
    return () => window.removeEventListener('pagehide', clear)
  }, [])

  const checklist = passwordChecklist(password, confirm, emailName)
  const strength  = passwordStrength(password)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (saving) return
    const problem = passwordError(password, confirm, emailName)
    if (problem) { setError(problem); passwordRef.current?.focus(); return }
    const token = tokenRef.current
    if (!token) { setStage('invalid'); return }

    setSaving(true)
    setError('')
    try {
      const res  = await fetch('/api/auth/password/set', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password, confirm }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string }
      if (res.ok) {
        tokenRef.current = null
        setPassword('')
        setConfirm('')
        setStage('done')
        return
      }
      if (res.status === 410) { tokenRef.current = null; setPassword(''); setConfirm(''); setStage('invalid'); return }
      setError(body.error ?? 'We could not set your password. Please try again in a minute.')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (stage === 'checking') {
    return (
      <div className="login-card-body" aria-busy={!checkError}>
        <div className="login-card-title">Set your password</div>
        {checkError ? (
          <>
            <div className="login-error" role="alert">{checkError}</div>
            <button type="button" className="login-btn" onClick={() => setAttempt(a => a + 1)}>
              <span className="login-btn-text">Try again</span>
              <span className="login-btn-arrow" aria-hidden="true">→</span>
            </button>
          </>
        ) : (
          <div className="sp-skeleton-group" aria-label="Checking your link">
            <div className="sp-skeleton" /><div className="sp-skeleton" /><div className="sp-skeleton short" />
          </div>
        )}
      </div>
    )
  }

  if (stage === 'done') {
    return (
      <div className="login-card-body">
        <div className="login-card-title" tabIndex={-1} ref={headingRef}>Your password is set</div>
        <div className="login-card-sub">
          You can now sign in with your email and your new password.
        </div>
        <a href="/login" className="login-btn sp-link-btn">
          <span className="login-btn-text">Go to sign in</span>
          <span className="login-btn-arrow" aria-hidden="true">→</span>
        </a>
      </div>
    )
  }

  if (stage === 'invalid') {
    return (
      <div className="login-card-body">
        <div className="login-card-title" tabIndex={-1} ref={headingRef}>{LINK_INVALID}</div>
        <div className="login-card-sub">
          Links work once and expire after 72 hours. We can email you a new one.
        </div>
        <button type="button" className="login-btn" onClick={() => setStage('forgot')}>
          <span className="login-btn-text">Send me a new link</span>
          <span className="login-btn-arrow" aria-hidden="true">→</span>
        </button>
        <div className="login-help">
          Already set your password? <a href="/login">Sign in</a>
        </div>
      </div>
    )
  }

  if (stage === 'forgot') {
    return (
      <div className="login-card-body">
        <ForgotPasswordForm
          title="Send me a new link"
          intro="Enter the email you sign in with. If it belongs to an account, we will email a new link."
        />
        <div className="login-help">
          Need help? <a href="mailto:hr@aemltd.com">hr@aemltd.com</a>
        </div>
      </div>
    )
  }

  return (
    <div className="login-card-body">
      <div className="login-card-title">Set your password</div>
      <div className="login-card-sub">Choose a password you have not used anywhere else. A password manager can create one for you.</div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="login-field">
          <label htmlFor="sp-password">New password</label>
          <div className="login-inp-wrap sp-inp-wrap">
            <span className="login-inp-icon" aria-hidden="true">•••</span>
            <input
              ref={passwordRef}
              type={showPassword ? 'text' : 'password'} id="sp-password"
              autoComplete="new-password" maxLength={PASSWORD_MAX * 2} spellCheck={false}
              value={password}
              onChange={e => { setPassword(e.target.value); setError('') }}
              aria-describedby="sp-rules sp-strength"
              aria-invalid={error ? true : undefined}
              required
            />
            <button
              type="button" className="sp-toggle"
              aria-controls="sp-password" aria-pressed={showPassword}
              onClick={() => setShowPassword(v => !v)}
            >
              {showPassword ? 'Hide' : 'Show'}<span className="sp-sr-only"> new password</span>
            </button>
          </div>
        </div>

        <div className="login-field">
          <label htmlFor="sp-confirm">Confirm password</label>
          <div className="login-inp-wrap sp-inp-wrap">
            <span className="login-inp-icon" aria-hidden="true">•••</span>
            <input
              type={showConfirm ? 'text' : 'password'} id="sp-confirm"
              autoComplete="new-password" maxLength={PASSWORD_MAX * 2} spellCheck={false}
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError('') }}
              aria-invalid={error ? true : undefined}
              required
            />
            <button
              type="button" className="sp-toggle"
              aria-controls="sp-confirm" aria-pressed={showConfirm}
              onClick={() => setShowConfirm(v => !v)}
            >
              {showConfirm ? 'Hide' : 'Show'}<span className="sp-sr-only"> confirm password</span>
            </button>
          </div>
        </div>

        <div id="sp-strength" className={`sp-strength ${password ? strength : 'empty'}`}>
          <span className="sp-strength-bar" aria-hidden="true"><span className="sp-strength-fill" /></span>
          <span className="sp-strength-text">
            {password ? <>Strength: <strong>{STRENGTH_LABELS[strength]}</strong></> : 'Strength appears as you type'}
          </span>
        </div>

        <ul id="sp-rules" className="sp-rules" aria-label="Password rules">
          {checklist.map(rule => (
            <li key={rule.id} className={rule.ok ? 'ok' : ''}>
              <span className="sp-rule-mark" aria-hidden="true">{rule.ok ? '✓' : '•'}</span>
              <span>{rule.label}</span>
              <span className="sp-sr-only">{rule.ok ? ' (done)' : ' (not yet)'}</span>
            </li>
          ))}
        </ul>

        <div aria-live="assertive">
          {error && <div className="login-error" role="alert">{error}</div>}
        </div>

        <button type="submit" className="login-btn" disabled={saving}>
          <span className="login-btn-text">{saving ? 'Saving…' : 'Set my password'}</span>
          <span className="login-btn-arrow" aria-hidden="true">{saving ? '...' : '→'}</span>
        </button>
      </form>

      <div className="login-help">
        Need help? <a href="mailto:hr@aemltd.com">hr@aemltd.com</a>
      </div>
    </div>
  )
}
