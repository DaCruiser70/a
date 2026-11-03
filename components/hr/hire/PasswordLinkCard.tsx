'use client'

import { useEffect, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { StatusPill } from '@/components/hr/hire/HireTabBar'
import type { LinkPurpose, LinkState, PasswordLinkStatus } from '@/lib/password-setup'

// Overview tab: how the hire gets into the portal. Shows where the welcome (or reset) email went,
// masked, and whether the set-password link is waiting, used, expired or was never sent.
// Resend and reset each issue a new link; every earlier unused link stops working.
// Nothing here is a password, a token or a full address.

const STATE_PILL: Record<LinkState, { tone: 'amber' | 'green' | 'grey' | 'red'; label: string }> = {
  waiting:      { tone: 'amber', label: 'Waiting' },
  password_set: { tone: 'green', label: 'Password set' },
  expired:      { tone: 'grey',  label: 'Expired' },
  not_sent:     { tone: 'red',   label: 'Not sent' },
  none:         { tone: 'grey',  label: 'No link yet' },
}

const PURPOSE_LABEL: Record<LinkPurpose, string> = {
  welcome: 'Welcome email',
  reset:   'Password reset email',
}

function formatDate(iso: string, withTime = false): string {
  return new Date(iso).toLocaleString('en-CA', {
    month: 'short', day: 'numeric', year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  })
}

export default function PasswordLinkCard({ hireId, onToast }: {
  hireId:  string
  onToast: (msg: string) => void
}) {
  const [status, setStatus]   = useState<PasswordLinkStatus | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [confirm, setConfirm] = useState<LinkPurpose | null>(null)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/hr/hires/${hireId}/password-link`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: PasswordLinkStatus) => { if (!cancelled) { setStatus(d); setLoadError(false) } })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [hireId, attempt])

  async function send(action: LinkPurpose) {
    setBusy(true)
    setError('')
    try {
      const res  = await fetch(`/api/hr/hires/${hireId}/password-link`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; to?: string | null }
      if (!res.ok) { setError(body.error ?? 'The email could not be sent. Please try again in a minute.'); return }
      setConfirm(null)
      onToast(`${PURPOSE_LABEL[action]} sent${body.to ? ` to ${body.to}` : ''}`)
      setAttempt(a => a + 1)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="hh-card" aria-labelledby="hh-access-title">
      <div className="hh-card-head">
        <h2 id="hh-access-title" className="hh-card-title">Sign-in access</h2>
        <p className="hh-card-sub">The hire sets their own password from an emailed link</p>
      </div>
      <div className="hh-card-body">
        {loadError && !status && (
          <div className="hh-error" role="alert">
            Sign-in access could not be loaded.
            <button type="button" className="hh-btn" onClick={() => setAttempt(a => a + 1)}>Try again</button>
          </div>
        )}
        {!status && !loadError && (
          <div aria-busy="true" aria-label="Loading sign-in access"><div className="hh-skeleton" /><div className="hh-skeleton" /></div>
        )}
        {status && (
          <>
            <div className="hh-access-row">
              <span className="hh-muted">Link:</span>
              <StatusPill tone={STATE_PILL[status.state].tone}>{STATE_PILL[status.state].label}</StatusPill>
            </div>
            <p className="hh-access-text">{describe(status)}</p>
            {status.state === 'none' && (
              <p className="hh-access-text muted">
                This account was set up before emailed links. Its temporary password keeps working until the hire
                sets a new one; send a password reset to move them to the new flow.
              </p>
            )}
            <div className="hh-access-actions">
              {!status.passwordSet && (
                <button type="button" className="hh-btn" onClick={() => { setError(''); setConfirm('welcome') }}>
                  Resend welcome email
                </button>
              )}
              {(status.passwordSet || status.state === 'none') && (
                <button type="button" className="hh-btn secondary" onClick={() => { setError(''); setConfirm('reset') }}>
                  Send password reset
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {confirm && (
        <Modal
          title={confirm === 'welcome' ? 'Resend the welcome email?' : 'Send a password reset?'}
          description={`A new link goes to ${status?.to ?? 'the hire'} and expires in 72 hours. Any earlier link stops working.`}
          onClose={() => setConfirm(null)}
          busy={busy}
        >
          {error && <div className="ui-modal-error" role="alert">{error}</div>}
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn-cancel" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className="ui-btn-primary" disabled={busy} onClick={() => send(confirm)}>
              {busy ? 'Sending…' : 'Send email'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}

function describe(s: PasswordLinkStatus): string {
  const label = PURPOSE_LABEL[s.purpose ?? 'welcome']
  const where = s.to ? ` to ${s.to}` : ''
  if (s.state === 'none') return 'No welcome email has been sent from the portal.'
  if (s.delivery === 'sent' && s.sentAt) {
    const sent = `${label}: sent ${formatDate(s.sentAt)}${where}.`
    if (s.state === 'waiting' && s.expiresAt) return `${sent} The link works until ${formatDate(s.expiresAt, true)}.`
    if (s.state === 'expired')               return `${sent} The link has expired; resend it to give them a new one.`
    return sent
  }
  const when = s.createdAt ? ` on ${formatDate(s.createdAt)}` : ''
  const why  = s.delivery === 'pending' ? 'email delivery is turned off' : 'the email could not be delivered'
  return `${label} was not sent${when} (${why}).`
}
