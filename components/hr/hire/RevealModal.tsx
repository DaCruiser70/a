'use client'

import { useEffect, useRef, useState } from 'react'
import Modal from '@/components/ui/Modal'
import { REVEAL_GROUP_LABELS, REVEAL_RESEND_SECONDS, REVEAL_VISIBLE_SECONDS, type RevealGroup } from '@/lib/reveal'

export type RevealedBanking = { institution_number: string; transit_number: string; account_number: string }
export type RevealedClearance = { legal_name: string | null; place_of_birth: string | null; dcn: string | null; date_of_birth: string | null }
export type RevealedPersonal = { date_of_birth: string | null; personal_phone: string | null }
export type RevealResult =
  | { group: 'banking'; values: RevealedBanking }
  | { group: 'sin'; values: string }
  | { group: 'personal'; values: RevealedPersonal }
  | { group: 'clearance'; values: RevealedClearance }

// "Reveal · code sent to your email": asks the server to email this HR user a 6-digit code,
// checks it, and hands the decrypted values to the page. Values are never logged, stored or put
// in the URL; the dev code is shown only when the server returns one (development only).
export default function RevealModal({ hireId, group, onClose, onRevealed, endpoint }: {
  hireId: string
  group: RevealGroup
  onClose: () => void
  onRevealed: (result: RevealResult) => void
  endpoint?: string   // base path of the request / verify routes; HR's by default
}) {
  const base = endpoint ?? `/api/hr/hires/${hireId}/reveal`
  const [phase, setPhase]       = useState<'sending' | 'ready' | 'unavailable'>('sending')
  const [code, setCode]         = useState('')
  const [error, setError]       = useState('')
  const [devCode, setDevCode]   = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(REVEAL_RESEND_SECONDS)
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const inputRef  = useRef<HTMLInputElement>(null)
  const requested = useRef(false)

  async function requestCode(): Promise<void> {
    setError('')
    try {
      const res = await fetch(`${base}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group }),
        cache: 'no-store',
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 503) { setPhase('unavailable'); return }
      if (!res.ok) { setPhase('ready'); setError(body.error ?? 'Could not send a code. Please try again.'); setCooldown(0); return }
      setDevCode(process.env.NODE_ENV !== 'production' && typeof body.devCode === 'string' ? body.devCode : null)
      setCode('')
      setCooldown(REVEAL_RESEND_SECONDS)
      setPhase('ready')
      requestAnimationFrame(() => inputRef.current?.focus())
    } catch {
      setPhase('ready')
      setCooldown(0)
      setError('Could not reach the server. Check your connection and try again.')
    }
  }

  // One code request when the dialog opens (the ref keeps React's development double-run from
  // sending two)
  useEffect(() => {
    if (requested.current) return
    requested.current = true
    void requestCode()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Resend cooldown
  useEffect(() => {
    if (phase !== 'ready' || cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, cooldown])

  async function resend() {
    setResending(true)
    await requestCode()
    setResending(false)
  }

  async function verify(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code)) { setError('Enter the 6-digit code from your email.'); inputRef.current?.focus(); return }
    setVerifying(true)
    setError('')
    try {
      const res = await fetch(`${base}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group, code }),
        cache: 'no-store',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'That code did not work. Please try again.')
        setCode('')
        if (body.expired) { setCooldown(0); setDevCode(null) }
        inputRef.current?.focus()
        return
      }
      const v = body.values
      if (group === 'banking') {
        onRevealed({ group, values: { institution_number: v.institution_number, transit_number: v.transit_number, account_number: v.account_number } })
      } else if (group === 'personal') {
        onRevealed({ group, values: { date_of_birth: v.date_of_birth ?? null, personal_phone: v.personal_phone ?? null } })
      } else if (group === 'clearance') {
        onRevealed({ group, values: { legal_name: v.legal_name ?? null, place_of_birth: v.place_of_birth ?? null, dcn: v.dcn ?? null, date_of_birth: v.date_of_birth ?? null } })
      } else {
        onRevealed({ group, values: v.sin })
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setVerifying(false)
    }
  }

  const what = REVEAL_GROUP_LABELS[group]

  return (
    <Modal
      title={`Reveal the ${what}`}
      description={`We email a 6-digit code to your work address. Enter it to see the ${what} for ${REVEAL_VISIBLE_SECONDS} seconds. Every request and reveal is recorded in the audit log.`}
      onClose={onClose}
      busy={verifying}
    >
      {phase === 'sending' && <p className="hh-modal-note" role="status">Sending your code…</p>}

      {phase === 'unavailable' && (
        <>
          <div className="ui-modal-error" role="alert">Reveal is unavailable right now. Please try again later.</div>
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn-cancel" onClick={onClose}>Close</button>
          </div>
        </>
      )}

      {phase === 'ready' && (
        <form onSubmit={verify} noValidate>
          <label htmlFor="hh-reveal-code" className="hh-label">6-digit code</label>
          <input
            id="hh-reveal-code"
            ref={inputRef}
            className="hh-code-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            disabled={verifying}
            aria-invalid={error ? true : undefined}
            aria-describedby={[error ? 'hh-reveal-error' : '', devCode ? 'hh-reveal-dev' : ''].filter(Boolean).join(' ') || undefined}
            onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
          />
          {devCode && (
            <p id="hh-reveal-dev" className="hh-modal-note">Development only: your code is <strong>{devCode}</strong></p>
          )}
          {error && <div id="hh-reveal-error" className="ui-modal-error" role="alert">{error}</div>}

          <div className="ui-modal-actions hh-reveal-actions">
            <button type="button" className="ui-btn-cancel" disabled={resending || verifying || cooldown > 0} onClick={resend}>
              {resending ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </button>
            <button type="button" className="ui-btn-cancel" disabled={verifying} onClick={onClose}>Cancel</button>
            <button type="submit" className="ui-btn-primary" disabled={verifying || code.length !== 6}>
              {verifying ? 'Checking…' : 'Reveal'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
