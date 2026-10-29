'use client'

import { useEffect, useRef, useState } from 'react'
import '../../styles/components/clearance-hr.css'
import { REGIONS, type Region } from '@/lib/regions'

type Props = {
  hireId:   string
  region:   Region | null
  editing:  boolean
  onEditingChange: (editing: boolean) => void
  onSaved:  (region: Region) => void
  onToast:  (msg: string) => void
}

// The hire's region on the HR hire page, shown apart from the office. HR can set or change it;
// saving moves any open or claimed project-management request to the new region's team.
export default function HireRegionRow({ hireId, region, editing, onEditingChange, onSaved, onToast }: Props) {
  const [value, setValue] = useState<string>(region ?? '')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const selectRef = useRef<HTMLSelectElement>(null)
  const editRef   = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(editing)

  // Focus the select when editing opens (also from the "Set region" prompt) and return focus after
  useEffect(() => {
    if (editing) {
      selectRef.current?.focus()
      selectRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    } else if (wasEditing.current) {
      editRef.current?.focus()
    }
    wasEditing.current = editing
  }, [editing])

  function open() {
    setValue(region ?? '')
    setError('')
    onEditingChange(true)
  }

  function cancel() {
    setError('')
    onEditingChange(false)
  }

  async function save(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!(REGIONS as readonly string[]).includes(value)) { setError('Choose a region from the list.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/hr/hires/${hireId}/region`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ region: value }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.error ?? 'Could not save the region. Please try again.'); return }
      onSaved(value as Region)
      onEditingChange(false)
      onToast(value === region ? 'Region saved' : `Region set to ${value}`)
    } catch {
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hrd-info-row">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!editing ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div>
              <div className="hrd-info-label">Region</div>
              <div className="hrd-info-value" style={region ? undefined : { color: '#B45309' }}>
                {region ?? 'Not set'}
              </div>
            </div>
            <button ref={editRef} type="button" className="hire-region-edit" onClick={open}>
              {region ? 'Change' : 'Set region'}
            </button>
          </div>
        ) : (
          <form onSubmit={save} noValidate>
            <div className="clr-hr-field" style={{ margin: 0 }}>
              <label htmlFor="hire-region-select">Region</label>
              <select
                id="hire-region-select"
                ref={selectRef}
                value={value}
                disabled={busy}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'hire-region-error' : 'hire-region-help'}
                onChange={e => { setValue(e.target.value); setError('') }}
                onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); cancel() } }}
              >
                <option value="">Select region</option>
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <span id="hire-region-help" className="clr-hr-note" style={{ marginTop: 0 }}>
                Separate from the office. An open or claimed project request moves to the new region&apos;s team.
              </span>
            </div>
            {error && <div id="hire-region-error" className="clr-hr-error" role="alert" style={{ margin: '8px 0 0' }}>{error}</div>}
            <div className="clr-hr-btns" style={{ marginTop: 8 }}>
              <button type="button" className="clr-hr-btn" disabled={busy} onClick={cancel}>Cancel</button>
              <button type="submit" className="clr-hr-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save region'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
