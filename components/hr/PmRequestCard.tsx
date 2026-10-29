'use client'

import { useEffect, useState } from 'react'
import '../../styles/components/clearance-hr.css'
import Modal from '@/components/ui/Modal'
import { PmChipBadge, formatPlanDate } from '@/components/ui/PlanBadges'
import { PortalTag } from '@/components/ui/PortalName'
import { PM_DETAIL_FIELDS, PM_DETAIL_LABELS, type PmDetails } from '@/lib/pm'
import type { PmChip } from '@/types'

type Data =
  | { needed: false }
  | {
      needed: true; state: PmChip; region: string | null
      claimed_by_name: string | null; claimed_at: string | null
      completed_by_name: string | null; completed_at: string | null
      details: PmDetails
    }

// Regional project management on the HR hire page: status, who has it, and HR's release action.
// Shown only for hires whose submitted manager plan asks for PSPC & RCMP.
export default function PmRequestCard({ hireId, onToast, onSetRegion }: {
  hireId: string
  onToast: (msg: string) => void
  onSetRegion: () => void   // opens the Region editor in Hire Details
}) {
  const [data, setData]       = useState<Data | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/hr/hires/${hireId}/pm-request`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: Data | null) => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [hireId, attempt])

  async function release() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/hr/hires/${hireId}/pm-request/release`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not release the claim. Please try again.'); return }
      setConfirm(false)
      onToast('Claim released')
      setAttempt(a => a + 1)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!data || !data.needed) return null

  return (
    <div className="hrd-card">
      <div className="hrd-card-header" style={{ flexWrap: 'wrap', rowGap: '8px' }}>
        <div className="hrd-card-icon amber">
          <svg viewBox="0 0 24 24" fill="none" stroke="#9A4F1D" strokeWidth="1.8" strokeLinecap="round">
            <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
          </svg>
        </div>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div className="hrd-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            Project Management
            <PortalTag role="project_mgmt">Projects</PortalTag>
          </div>
          <div className="hrd-card-sub">{data.region ? `${data.region} team` : 'Regional team'} · PSPC &amp; RCMP clearance</div>
        </div>
        <PmChipBadge state={data.state} claimedByName={data.claimed_by_name} />
      </div>

      <div className="clr-hr-body">
        {data.state === 'needs_region' && (
          <div className="clr-hr-hint">
            This hire has no region yet. Set it (Ontario, New Brunswick or Nova Scotia) so the request
            opens for that region&apos;s team.
          </div>
        )}
        {data.state === 'open' && <div className="clr-hr-hint">Waiting for someone on the regional team to claim it.</div>}
        {data.state === 'claimed' && (
          <div className="clr-hr-hint">
            Claimed by <strong>{data.claimed_by_name ?? 'a team member'}</strong>
            {data.claimed_at ? ` on ${formatPlanDate(data.claimed_at)}` : ''}.
          </div>
        )}
        {data.state === 'done' && (
          <div className="clr-hr-hint">
            Done{data.completed_by_name ? ` by ${data.completed_by_name}` : ''}
            {data.completed_at ? ` on ${formatPlanDate(data.completed_at)}` : ''}.
          </div>
        )}
      </div>

      {data.state !== 'needs_region' && (
        <div className="clr-hr-body" style={{ paddingTop: 0 }}>
          <div className="clr-hr-section-title">Project details</div>
          <dl className="pm-hr-rows">
            {PM_DETAIL_FIELDS.map(f => (
              <div key={f} className="pm-hr-row">
                <dt>{PM_DETAIL_LABELS[f]}</dt>
                <dd className={data.details[f] ? '' : 'empty'}>{data.details[f] || 'Not provided'}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {data.state === 'needs_region' && (
        <div className="clr-hr-actions">
          <button type="button" className="clr-hr-btn primary" onClick={onSetRegion}>Set region</button>
        </div>
      )}

      {data.state === 'claimed' && (
        <div className="clr-hr-actions">
          <button type="button" className="clr-hr-btn" onClick={() => { setError(''); setConfirm(true) }}>Release claim</button>
        </div>
      )}

      {confirm && (
        <Modal
          title="Release this claim?"
          description="The request goes back to the regional team's Open list so someone else can claim it."
          onClose={() => setConfirm(false)}
          busy={busy}
        >
          {error && <div className="ui-modal-error" role="alert">{error}</div>}
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn-cancel" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
            <button type="button" className="ui-btn-primary" disabled={busy} onClick={release}>{busy ? 'Releasing…' : 'Release claim'}</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
