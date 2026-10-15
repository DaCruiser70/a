'use client'

import { useId, useState } from 'react'
import '../../styles/components/clearance-hr.css'
import {
  PSPC_RECIPIENT, RCMP_RECIPIENTS, rcmpRecipientForOffice, isRemoteOffice, type RcmpRecipientKey,
} from '@/lib/clearance'
import { formatPlanDate } from '@/components/ui/PlanBadges'
import type { HrClearanceView } from '@/lib/clearance-server'

type View = Extract<HrClearanceView, { required: true }>
type MarkAction = 'pspc_sent' | 'rcmp_sent' | 'cleared'

function Check({ done, label, detail }: { done: boolean; label: string; detail?: string }) {
  return (
    <li className={`clr-hr-check${done ? ' done' : ''}`}>
      <span className="clr-hr-check-mark" aria-hidden="true">
        {done
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/></svg>}
      </span>
      <span>
        <span className="clr-hr-check-label">{label}</span>
        <span className="clr-hr-check-state">{done ? 'Received' : 'Not yet'}{detail ? ` · ${detail}` : ''}</span>
      </span>
    </li>
  )
}

// HR's clearance tracker: what has arrived, who each package goes to, and when each step happened.
// Nothing is emailed from the portal; HR sends the packages and records it here.
export default function ClearanceTrackerCard({
  hireId, view, onChange, onToast,
}: {
  hireId:   string
  view:     View
  onChange: (view: View) => void
  onToast:  (msg: string) => void
}) {
  const selectId = useId()
  const [busy, setBusy]     = useState<string | null>(null)
  const [error, setError]   = useState('')
  const [remoteChoice, setRemoteChoice] = useState<RcmpRecipientKey | ''>('')

  const approved   = view.status === 'approved'
  const submitted  = view.status !== 'pending'
  const remote     = isRemoteOffice(view.office_location)
  const officeKey  = rcmpRecipientForOffice(view.office_location)
  const t          = view.tracking
  const sentTo     = t.rcmp_recipient ? Object.values(RCMP_RECIPIENTS).find(r => r.email === t.rcmp_recipient) : null
  const rcmpTarget = sentTo ?? (officeKey ? RCMP_RECIPIENTS[officeKey] : remoteChoice ? RCMP_RECIPIENTS[remoteChoice] : null)

  async function post(action: MarkAction | 'copy_pspc_details') {
    setBusy(action)
    setError('')
    try {
      const res = await fetch(`/api/hr/hires/${hireId}/clearance/tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'rcmp_sent' && remote && remoteChoice ? { action, rcmpRecipient: remoteChoice } : { action }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not save. Please try again.'); return }
      if (action === 'copy_pspc_details') {
        await navigator.clipboard.writeText(body.text as string)
        onToast('PSPC email details copied')
        return
      }
      if (body.view?.required) onChange(body.view as View)
      onToast(action === 'cleared' ? 'Marked as cleared' : 'Package marked as sent')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(null)
    }
  }

  const stamp = (at: string | null, by: string | null) => at ? `${formatPlanDate(at)}${by ? ` by ${by}` : ''}` : null

  return (
    <div className="hrd-card">
      <div className="hrd-card-header">
        <div className="hrd-card-icon navy">
          <svg viewBox="0 0 24 24" fill="none" stroke="#1B3A6B" strokeWidth="1.8" strokeLinecap="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>
          </svg>
        </div>
        <div>
          <div className="hrd-card-title">Clearance Tracker</div>
          <div className="hrd-card-sub">{view.type === 'pspc_rcmp' ? 'PSPC & RCMP' : 'RCMP only'} · nothing is emailed from the portal</div>
        </div>
      </div>

      <div className="clr-hr-body">
        <div className="clr-hr-section-title">Received</div>
        <ul className="clr-hr-checks">
          <Check done={!!view.legal_name && view.has_place_of_birth} label="Legal name and place of birth" />
          {view.fingerprint && <Check done={view.has_fingerprint} label="Fingerprint form" detail={view.has_dcn ? 'DCN provided' : undefined} />}
          <Check done={view.has_rcmp} label="RCMP form" />
          <Check done={!!view.id} label="ID in Documents" detail={view.id?.label} />
        </ul>

        <div className="clr-hr-section-title">Sends to</div>
        <div className="clr-hr-recipients">
          {view.fingerprint && (
            <div className="clr-hr-recipient">
              <div className="clr-hr-recipient-kind">PSPC package</div>
              <div className="clr-hr-recipient-name">{PSPC_RECIPIENT.name}</div>
              <div className="clr-hr-recipient-email">{PSPC_RECIPIENT.email}</div>
              {stamp(t.pspc_sent_at, t.pspc_sent_by_name) && <div className="clr-hr-stamp">Sent {stamp(t.pspc_sent_at, t.pspc_sent_by_name)}</div>}
            </div>
          )}
          <div className="clr-hr-recipient">
            <div className="clr-hr-recipient-kind">RCMP package{view.office_location ? ` · ${view.office_location} office` : ''}</div>
            {remote && !t.rcmp_recipient ? (
              <div className="clr-hr-field">
                <label htmlFor={selectId}>Recipient (remote hire)</label>
                <select id={selectId} value={remoteChoice} onChange={e => setRemoteChoice(e.target.value as RcmpRecipientKey | '')}>
                  <option value="">Choose who receives it</option>
                  {Object.values(RCMP_RECIPIENTS).map(r => <option key={r.key} value={r.key}>{r.name}</option>)}
                </select>
              </div>
            ) : null}
            {rcmpTarget ? (
              <>
                <div className="clr-hr-recipient-name">{rcmpTarget.name}</div>
                <div className="clr-hr-recipient-email">{rcmpTarget.email}</div>
              </>
            ) : !remote && <div className="clr-hr-recipient-email">No office set for this hire</div>}
            <div className="clr-hr-note">HR completes the detachments list and PSPC file number in the Excel before sending.</div>
            {stamp(t.rcmp_sent_at, t.rcmp_sent_by_name) && <div className="clr-hr-stamp">Sent {stamp(t.rcmp_sent_at, t.rcmp_sent_by_name)}</div>}
          </div>
        </div>

        {stamp(t.cleared_at, t.cleared_by_name) && (
          <div className="clr-hr-cleared">Cleared {stamp(t.cleared_at, t.cleared_by_name)}</div>
        )}

        {error && <div className="clr-hr-error" role="alert">{error}</div>}
        {!approved && (
          <div className="clr-hr-hint">{submitted ? 'Approve the clearance form to record the packages.' : 'Waiting for the hire to submit the clearance form.'}</div>
        )}
      </div>

      <div className="clr-hr-actions">
        {view.fingerprint && (
          <button type="button" className="clr-hr-btn" disabled={!submitted || busy !== null} onClick={() => post('copy_pspc_details')}>
            {busy === 'copy_pspc_details' ? 'Copying…' : 'Copy PSPC email details'}
          </button>
        )}
        {view.fingerprint && (
          <button type="button" className="clr-hr-btn" disabled={!approved || !!t.pspc_sent_at || busy !== null} onClick={() => post('pspc_sent')}>
            {t.pspc_sent_at ? 'PSPC package sent' : busy === 'pspc_sent' ? 'Saving…' : 'Mark PSPC package sent'}
          </button>
        )}
        <button
          type="button" className="clr-hr-btn"
          disabled={!approved || !!t.rcmp_sent_at || busy !== null || (remote && !remoteChoice && !t.rcmp_recipient) || (!remote && !officeKey)}
          onClick={() => post('rcmp_sent')}
        >
          {t.rcmp_sent_at ? 'RCMP package sent' : busy === 'rcmp_sent' ? 'Saving…' : 'Mark RCMP package sent'}
        </button>
        <button type="button" className="clr-hr-btn primary" disabled={!approved || !!t.cleared_at || busy !== null} onClick={() => post('cleared')}>
          {t.cleared_at ? 'Cleared' : busy === 'cleared' ? 'Saving…' : 'Mark cleared'}
        </button>
      </div>
    </div>
  )
}
