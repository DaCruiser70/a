'use client'

import { useEffect, useRef, useState } from 'react'
import '../../styles/pages/hr-hire.css'
import Modal from '@/components/ui/Modal'
import {
  VEHICLE_GROUPS, VEHICLE_FIELDS, VEHICLE_FIELD_LABELS, VEHICLE_FIELD_MAX, GAS_CARD_LABEL, gasCardText,
  type VehicleDetails, type VehicleField, type VehicleStep,
} from '@/lib/vehicle'

type Data = {
  step: VehicleStep
  my_step: 'rob' | 'heather' | 'marley' | null
  my_steps: ('rob' | 'heather' | 'marley')[]
  details: VehicleDetails
  gas_card: boolean | null
  rob: { name: string | null; at: string | null }
  heather: { name: string | null; at: string | null }
  marley: { name: string | null; at: string | null }
}

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : ''
const blank = (): Record<VehicleField, string> => Object.fromEntries(VEHICLE_FIELDS.map(f => [f, ''])) as Record<VehicleField, string>

// The Complete dialog for a company vehicle task. Rob and Heather fill / edit the vehicle details
// (all optional); Marley sees them read-only and confirms the insurance. The server decides whose
// turn it is and checks everything again.
export default function VehicleTaskModal({ hireId, hireName, onClose, onDone }: {
  hireId: string
  hireName: string
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [data, setData]       = useState<Data | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [form, setForm]       = useState<Record<VehicleField, string>>(blank)
  const [gas, setGas]         = useState<'yes' | 'no' | null>(null)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/stakeholder/vehicle/${hireId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: Data) => {
        if (cancelled) return
        setData(d)
        setForm({ ...blank(), ...d.details } as Record<VehicleField, string>)
        setGas(d.gas_card === null ? null : d.gas_card ? 'yes' : 'no')
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [hireId])

  async function submit(e?: React.SyntheticEvent) {
    e?.preventDefault()
    if (!data?.my_step) return
    setSaving(true)
    setError('')
    try {
      const body = data.my_step === 'marley' ? { step: 'marley' } : { step: data.my_step, details: form, gasCard: gas }
      const res = await fetch(`/api/stakeholder/vehicle/${hireId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(out.error ?? 'Could not save. Please try again.')
        requestAnimationFrame(() => errorRef.current?.focus())
        return
      }
      onDone(data.my_step === 'marley' ? 'Vehicle insurance confirmed' : data.my_step === 'rob' ? 'Vehicle details sent to Heather' : 'Vehicle details completed')
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const mode = data?.my_step
  const title = mode === 'marley' || (!mode && data?.my_steps.includes('marley')) ? 'Confirm vehicle insurance' : 'Complete vehicle details'

  return (
    <div className="vh-scope">
      <Modal
        title={title}
        description={`Company vehicle for ${hireName}.${mode === 'marley' ? ' Check the details, then confirm the vehicle insurance. You cannot change the details.' : mode ? ' Fill in what you know; every field is optional.' : ''}`}
        onClose={onClose}
        busy={saving}
      >
        {!data && !loadError && <div aria-busy="true"><div className="hh-skeleton" /><div className="hh-skeleton" /></div>}
        {loadError && <div className="ui-modal-error" role="alert">The vehicle request could not be loaded.</div>}

        {data && !mode && (
          <p className="hh-modal-note" role="status">
            {data.step === 'complete' ? 'This vehicle request is complete.' : 'Your step is already completed, or it is not your turn yet.'}
          </p>
        )}

        {/* Rob and Heather: the form */}
        {data && (mode === 'rob' || mode === 'heather') && (
          <form className="vh-form vh-modal-wide" onSubmit={submit} noValidate>
            {mode === 'heather' && data.rob.at && (
              <p className="vh-byline">Filled in by {data.rob.name ?? 'Rob'}, {when(data.rob.at)}. You can change any field.</p>
            )}
            {VEHICLE_GROUPS.map(g => (
              <fieldset key={g.title} className="vh-fieldset">
                <legend className="vh-legend">{g.title}</legend>
                <div className="vh-fields">
                  {g.fields.map(f => (
                    <div key={f} className="vh-field">
                      <label htmlFor={`vh-${f}`}>{VEHICLE_FIELD_LABELS[f]} <span className="vh-byline">(optional)</span></label>
                      <input
                        id={`vh-${f}`}
                        className="vh-input"
                        value={form[f]}
                        maxLength={VEHICLE_FIELD_MAX[f]}
                        inputMode={f === 'year' ? 'numeric' : undefined}
                        autoCapitalize={f === 'vin' || f === 'license_plate' ? 'characters' : undefined}
                        disabled={saving}
                        onChange={e => setForm(prev => ({ ...prev, [f]: e.target.value }))}
                      />
                    </div>
                  ))}
                  {g.gasCard && (
                    <fieldset className="vh-field vh-fieldset">
                      <legend className="vh-field-legend"><span className="vh-legend-inline">{GAS_CARD_LABEL}</span> <span className="vh-byline">(optional)</span></legend>
                      <div className="vh-radios">
                        {(['yes', 'no'] as const).map(v => (
                          <label key={v} className="vh-radio">
                            <input type="radio" name="vh-gas" value={v} checked={gas === v} disabled={saving} onChange={() => setGas(v)} />
                            {v === 'yes' ? 'Yes' : 'No'}
                          </label>
                        ))}
                        {gas !== null && (
                          <button type="button" className="hh-btn secondary small" disabled={saving} onClick={() => setGas(null)}>Clear</button>
                        )}
                      </div>
                    </fieldset>
                  )}
                </div>
              </fieldset>
            ))}
            {error && <div ref={errorRef} tabIndex={-1} className="ui-modal-error" role="alert">{error}</div>}
            <div className="ui-modal-actions">
              <button type="button" className="ui-btn-cancel" disabled={saving} onClick={onClose}>Cancel</button>
              <button type="submit" className="hh-btn approve" disabled={saving}>
                {saving ? 'Saving…' : mode === 'rob' ? 'Complete and send to Heather' : 'Complete vehicle details'}
              </button>
            </div>
          </form>
        )}

        {/* Marley: read-only summary and confirm */}
        {data && mode === 'marley' && (
          <div className="vh-panel vh-modal-wide">
            <span className="vh-tag">Vehicle insurance</span>
            {VEHICLE_GROUPS.map(g => (
              <section key={g.title} className="vh-group" aria-label={g.title}>
                <div className="vh-legend">{g.title}</div>
                <dl className="vh-grid">
                  {g.fields.map(f => (
                    <div key={f} className="vh-item">
                      <dt>{VEHICLE_FIELD_LABELS[f]}</dt>
                      <dd className={data.details[f] ? '' : 'vh-empty'}>{data.details[f] ?? 'Not provided'}</dd>
                    </div>
                  ))}
                  {g.gasCard && (
                    <div className="vh-item">
                      <dt>{GAS_CARD_LABEL}</dt>
                      <dd className={data.gas_card === null ? 'vh-empty' : ''}>{gasCardText(data.gas_card)}</dd>
                    </div>
                  )}
                </dl>
              </section>
            ))}
            <section className="vh-group" aria-label="Completed by">
              <div className="vh-legend">Completed by</div>
              <ol className="vh-steps">
                <li>Vehicle details: {data.rob.name ?? 'Rob'}{data.rob.at ? `, ${when(data.rob.at)}` : ''}</li>
                <li>Checked and completed: {data.heather.name ?? 'Heather'}{data.heather.at ? `, ${when(data.heather.at)}` : ''}</li>
              </ol>
            </section>
            {error && <div ref={errorRef} tabIndex={-1} className="ui-modal-error" role="alert">{error}</div>}
            <div className="ui-modal-actions">
              <button type="button" className="ui-btn-cancel" disabled={saving} onClick={onClose}>Cancel</button>
              <button type="button" className="hh-btn approve" disabled={saving} onClick={() => submit()}>
                {saving ? 'Confirming…' : 'Confirm vehicle insurance'}
              </button>
            </div>
          </div>
        )}

        {data && !mode && (
          <div className="ui-modal-actions">
            <button type="button" className="ui-btn-cancel" onClick={onClose}>Close</button>
          </div>
        )}
      </Modal>
    </div>
  )
}
