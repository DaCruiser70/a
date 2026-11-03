'use client'

import { useId, useState } from 'react'
import { StatusPill } from '@/components/hr/hire/HireTabBar'
import {
  VEHICLE_GROUPS, VEHICLE_FIELD_LABELS, VEHICLE_STEP_LABELS, GAS_CARD_LABEL, LICENSE_STATUS_LABELS,
  gasCardText, insuranceWaitingReason,
  type LicenseStatus, type VehicleDetails, type VehicleStep,
} from '@/lib/vehicle'
import type { Tone } from '@/lib/hr-hire'

type View = {
  step: VehicleStep
  details: VehicleDetails
  gas_card: boolean | null
  license: LicenseStatus
  waiting: string | null
  rob: { name: string | null; at: string | null }
  heather: { name: string | null; at: string | null }
  marley: { name: string | null; at: string | null }
}

const STEP_TONE: Record<VehicleStep, Tone> = {
  rob: 'amber', heather: 'amber', license: 'amber', marley: 'copper', complete: 'green', cancelled: 'grey',
}
const LICENSE_TONE: Record<LicenseStatus, Tone> = { approved: 'green', review: 'amber', rejected: 'red', missing: 'grey' }
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : null

// Company vehicle request in HR's Stakeholder confirmations: the current step as a solid pill, and a
// dropdown (like "View note") that loads the details from the server only when opened. Read-only:
// HR has no buttons that change the request. license: the hire's Driver's License status, which
// explains a "Waiting on the licence" step.
export default function VehicleRequestRow({ hireId, step, license }: {
  hireId: string; step: VehicleStep; license: LicenseStatus | null
}) {
  const panelId = useId()
  const [open, setOpen]     = useState(false)
  const [view, setView]     = useState<View | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !view) {
      setStatus('loading')
      try {
        const res = await fetch(`/api/hr/hires/${hireId}/vehicle`, { cache: 'no-store' })
        if (!res.ok) throw new Error()
        setView(await res.json())
        setStatus('idle')
      } catch {
        setStatus('error')
      }
    }
  }

  // Close and forget the decrypted details when hidden
  function hide() {
    setOpen(false)
    setView(null)
  }

  return (
    <div className="hh-stake">
      <div className="hh-stake-row">
        <div className="hh-doc-text">
          <div className="hh-doc-name">Company Vehicle</div>
          <div className="hh-doc-meta">
            {step === 'cancelled'
              ? 'Cancelled: Company Vehicle was removed before the request was complete'
              : step === 'license' && license
                ? insuranceWaitingReason(step, license)
                : 'Rob fills the details, Heather completes them; once the Driver’s License is approved, Marley confirms the insurance'}
          </div>
        </div>
        <StatusPill tone={STEP_TONE[step]}>{VEHICLE_STEP_LABELS[step]}</StatusPill>
        <button
          type="button"
          className={`hh-btn${open ? ' secondary' : ''}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={open ? hide : toggle}
        >
          {open ? 'Hide' : 'View vehicle details'}
        </button>
      </div>

      {open && (
        <div id={panelId} className="hh-note-reveal vh-panel">
          {status === 'loading' && <div aria-busy="true"><div className="hh-skeleton" /><div className="hh-skeleton" /></div>}
          {status === 'error' && <div className="hh-error" role="alert">The vehicle details could not be loaded.</div>}
          {view && (
            <>
              {VEHICLE_GROUPS.map(g => (
                <section key={g.title} className="vh-group" aria-label={g.title}>
                  <div className="hh-note-reveal-head"><span>{g.title}</span></div>
                  <dl className="vh-grid">
                    {g.fields.map(f => (
                      <div key={f} className="vh-item">
                        <dt>{VEHICLE_FIELD_LABELS[f]}</dt>
                        <dd className={view.details[f] ? '' : 'vh-empty'}>{view.details[f] ?? 'Not provided'}</dd>
                      </div>
                    ))}
                    {g.gasCard && (
                      <div className="vh-item">
                        <dt>{GAS_CARD_LABEL}</dt>
                        <dd className={view.gas_card === null ? 'vh-empty' : ''}>{gasCardText(view.gas_card)}</dd>
                      </div>
                    )}
                  </dl>
                </section>
              ))}
              <section className="vh-group" aria-label="Steps">
                <div className="hh-note-reveal-head"><span>Steps</span></div>
                <ol className="vh-steps">
                  <li><strong>1. Vehicle details</strong> · {view.rob.at ? `${view.rob.name ?? 'Rob'}, ${when(view.rob.at)}` : 'Waiting on Rob'}</li>
                  <li><strong>2. Checked and completed</strong> · {view.heather.at ? `${view.heather.name ?? 'Heather'}, ${when(view.heather.at)}` : 'Waiting on Heather'}</li>
                  <li>
                    <strong>3. Driver’s License</strong> · <StatusPill tone={LICENSE_TONE[view.license]}>{LICENSE_STATUS_LABELS[view.license]}</StatusPill>
                  </li>
                  <li>
                    <strong>4. Vehicle insurance</strong> · {view.marley.at
                      ? `Confirmed by ${view.marley.name ?? 'Marley'}, ${when(view.marley.at)}`
                      : view.step === 'marley' ? 'Waiting on Marley' : view.step === 'cancelled' ? 'Cancelled' : view.waiting ?? 'Not started'}
                  </li>
                </ol>
              </section>
            </>
          )}
        </div>
      )}
    </div>
  )
}
