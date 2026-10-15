'use client'

import { useState } from 'react'
import '../../styles/components/clearance-hr.css'
import { timeAgo } from '@/lib/time-ago'
import { CLEARANCE_STATUS_LABELS, formatDcn } from '@/lib/clearance'
import type { HrClearanceView } from '@/lib/clearance-server'

type View = Extract<HrClearanceView, { required: true }>
type RevealField = 'place_of_birth' | 'dcn'

const DOC_STATUS_LABELS: Record<string, string> = {
  pending: 'Uploaded', review: 'Under review', approved: 'Approved', rejected: 'Rejected',
}

// "Security Clearance" row in the HR Form Review card. Tracked separately: it is never counted in
// the 4/4 form total and never changes the hire's status. Approve and Flag go through the page's
// existing handlers and flag-reason modal (formId 'clearance').
export default function ClearanceReviewRow({
  hireId, view, onApprove, onFlag, onToast,
}: {
  hireId:    string
  view:      View
  onApprove: () => void
  onFlag:    () => void
  onToast:   (msg: string) => void
}) {
  const [open, setOpen]         = useState(false)
  const [revealed, setRevealed] = useState<Partial<Record<RevealField, string>>>({})
  const [busy, setBusy]         = useState<string | null>(null)

  const status    = view.status
  const submitted = status !== 'pending'

  async function reveal(field: RevealField) {
    if (revealed[field] !== undefined) {
      setRevealed(r => { const next = { ...r }; delete next[field]; return next })
      return
    }
    setBusy(field)
    try {
      const res = await fetch(`/api/hr/hires/${hireId}/clearance/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field }),
      })
      if (!res.ok) { onToast('Could not reveal this field'); return }
      const { value } = await res.json()
      setRevealed(r => ({ ...r, [field]: value as string }))
    } catch {
      onToast('Could not reveal this field')
    } finally {
      setBusy(null)
    }
  }

  async function openFile(kind: 'fingerprint' | 'rcmp', download: boolean) {
    const key = `${kind}-${download ? 'dl' : 'view'}`
    setBusy(key)
    try {
      const res = await fetch(`/api/hr/hires/${hireId}/clearance/file/${kind}${download ? '?download=1' : ''}`)
      if (!res.ok) { onToast('Could not load the file'); return }
      const { url } = await res.json()
      if (download) window.location.href = url
      else window.open(url, '_blank', 'noopener')
    } catch {
      onToast('Could not load the file')
    } finally {
      setBusy(null)
    }
  }

  const stepClass = status === 'approved' ? 'approved' : status === 'flagged' ? 'flagged' : status === 'review' ? 'review' : 'pending'
  const rcmpIsSheet = view.rcmp_ext === 'xlsx'

  return (
    <div className="hrd-form-item clr-hr-row">
      <div className="hrd-form-row">
        <div className={`hrd-form-step ${stepClass}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {status === 'approved'
              ? <polyline points="20 6 9 17 4 12"/>
              : <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>}
          </svg>
        </div>
        <div className="hrd-form-info">
          <div className="hrd-form-name">Security Clearance</div>
          <div className="hrd-form-date">
            Tracked separately · {view.type === 'pspc_rcmp' ? 'PSPC & RCMP' : 'RCMP only'}
            {submitted ? ` · Submitted ${timeAgo(view.submitted_at)}` : ' · Not yet submitted'}
          </div>
        </div>
        <span className={`hrd-form-status ${status}`}>{CLEARANCE_STATUS_LABELS[status]}</span>
        {submitted && (
          <div className="hrd-form-inline-actions">
            <button className="hrd-inline-btn expand" aria-expanded={open} onClick={() => setOpen(v => !v)}>
              {open ? 'Hide' : 'View'}
            </button>
          </div>
        )}
      </div>

      <div className={`hrd-form-data ${open ? 'open' : ''}`}>
        <div className="hrd-data-grid">
          <div className="hrd-data-full">
            <div className="hrd-data-label">Legal name</div>
            <div className="hrd-data-value">{view.legal_name ?? '—'}</div>
          </div>

          <div className="hrd-sensitive-row hrd-data-full">
            <div className="hrd-sensitive-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Place of birth — encrypted
            </div>
            <button className="hrd-sensitive-btn" disabled={!view.has_place_of_birth || busy === 'place_of_birth'} onClick={() => reveal('place_of_birth')}>
              {busy === 'place_of_birth' ? 'Loading…' : revealed.place_of_birth !== undefined ? 'Hide' : 'Reveal'}
            </button>
          </div>
          {revealed.place_of_birth !== undefined && (
            <div className="hrd-data-full"><div className="hrd-data-value clr-hr-secret">{revealed.place_of_birth}</div></div>
          )}

          {view.fingerprint && (
            <>
              <div className="hrd-sensitive-row hrd-data-full">
                <div className="hrd-sensitive-label">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  DCN — encrypted{view.has_dcn ? '' : ' · not provided'}
                </div>
                {view.has_dcn && (
                  <button className="hrd-sensitive-btn" disabled={busy === 'dcn'} onClick={() => reveal('dcn')}>
                    {busy === 'dcn' ? 'Loading…' : revealed.dcn !== undefined ? 'Hide' : 'Reveal'}
                  </button>
                )}
              </div>
              {revealed.dcn !== undefined && (
                <div className="hrd-data-full"><div className="hrd-data-value clr-hr-secret">{formatDcn(revealed.dcn)}</div></div>
              )}

              <div className="hrd-sensitive-row hrd-data-full">
                <div className="hrd-sensitive-label">Fingerprint form{view.fingerprint_name ? ` · ${view.fingerprint_name}` : ' · not uploaded'}</div>
                {view.has_fingerprint && (
                  <div className="clr-hr-btns">
                    <button className="hrd-sensitive-btn" disabled={busy === 'fingerprint-view'} onClick={() => openFile('fingerprint', false)}>View</button>
                    <button className="hrd-sensitive-btn" disabled={busy === 'fingerprint-dl'} onClick={() => openFile('fingerprint', true)}>
                      {busy === 'fingerprint-dl' ? 'Downloading…' : 'Download'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          <div className="hrd-sensitive-row hrd-data-full">
            <div className="hrd-sensitive-label">
              RCMP form{view.rcmp_name ? ` · ${view.rcmp_name}` : ' · not uploaded'}
              {rcmpIsSheet && ' · Excel, download only'}
            </div>
            {view.has_rcmp && (
              <div className="clr-hr-btns">
                {/* A spreadsheet cannot be previewed in the browser: download only */}
                {!rcmpIsSheet && (
                  <button className="hrd-sensitive-btn" disabled={busy === 'rcmp-view'} onClick={() => openFile('rcmp', false)}>View</button>
                )}
                <button className="hrd-sensitive-btn" disabled={busy === 'rcmp-dl'} onClick={() => openFile('rcmp', true)}>
                  {busy === 'rcmp-dl' ? 'Downloading…' : 'Download'}
                </button>
              </div>
            )}
          </div>

          <div className="hrd-data-full">
            <div className="hrd-data-label">ID (from Documents)</div>
            <div className="hrd-data-value">
              {view.id ? `${view.id.label} · ${DOC_STATUS_LABELS[view.id.status] ?? view.id.status}` : 'Not on file'}
            </div>
          </div>
        </div>

        {status === 'flagged' && view.flag_reason && (
          <div className="clr-hr-flag">
            <div className="clr-hr-flag-title">Flag Reason</div>
            <div className="clr-hr-flag-text">{view.flag_reason}</div>
          </div>
        )}

        {status !== 'approved' && (
          <div className="hrd-expanded-actions">
            {(status === 'review' || status === 'flagged') && (
              <button className="hrd-inline-btn approve" onClick={onApprove}>✓ Approve this form</button>
            )}
            {status !== 'flagged' && (
              <button className="hrd-inline-btn flag" onClick={onFlag}>Flag this form</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
