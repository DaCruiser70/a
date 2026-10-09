'use client'

import { useEffect, useId, useRef, useState } from 'react'
import '../../styles/components/manager-select.css'

type ManagerOption = { id: string; name: string }

// Searchable, required dropdown over the manager directory (GET /api/hr/managers).
// Only the selected id leaves this component; the server copies the name and email.
export default function ManagerSelect({
  value, onChange, invalid = false, label = 'Reporting Manager',
}: {
  value:     string
  onChange:  (id: string) => void
  invalid?:  boolean
  label?:    string
}) {
  const [managers, setManagers] = useState<ManagerOption[]>([])
  const [status, setStatus]     = useState<'loading' | 'ready' | 'error'>('loading')
  // null = show the selected manager's name; a string = what the user is typing
  const [query, setQuery]       = useState<string | null>(null)
  const [open, setOpen]         = useState(false)
  const [active, setActive]     = useState(0)
  const [attempt, setAttempt]   = useState(0)

  const inputId   = useId()
  const listId    = useId()
  const hintId    = useId()
  const listRef   = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/hr/managers?limit=100', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((data: { managers?: ManagerOption[] }) => {
        if (cancelled) return
        setManagers(data.managers ?? [])
        setStatus('ready')
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [attempt])

  const selected = managers.find(m => m.id === value) ?? null

  const text     = query ?? selected?.name ?? ''
  const filtered = query === null
    ? managers
    : managers.filter(m => m.name.toLowerCase().includes(query.trim().toLowerCase()))

  function choose(m: ManagerOption) {
    onChange(m.id)
    setQuery(null)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { setOpen(true); setActive(0); return }
      setActive(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) { e.preventDefault(); choose(filtered[active]) }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
    }
  }

  function onBlur() {
    setOpen(false)
    // Free text never counts as a choice: snap back to the selected name, or clear
    setQuery(null)
  }

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  if (status === 'loading') {
    return (
      <div className="manager-select">
        <label className="manager-select-label" htmlFor={inputId}>{label} <span className="manager-select-req" aria-hidden="true">*</span></label>
        <div className="manager-select-skeleton" aria-busy="true" aria-label="Loading managers" />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="manager-select">
        <span className="manager-select-label">{label} <span className="manager-select-req" aria-hidden="true">*</span></span>
        <div className="manager-select-message error" role="alert">
          We couldn&apos;t load the manager list.
          <button type="button" className="manager-select-retry" onClick={() => { setStatus('loading'); setAttempt(a => a + 1) }}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  const activeId = open && filtered[active] ? `${listId}-${filtered[active].id}` : undefined

  return (
    <div className="manager-select">
      <label className="manager-select-label" htmlFor={inputId}>
        {label} <span className="manager-select-req" aria-hidden="true">*</span>
      </label>
      <div className="manager-select-control">
        <input
          id={inputId}
          className={`manager-select-input${invalid ? ' invalid' : ''}`}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-required="true"
          aria-invalid={invalid || undefined}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-describedby={hintId}
          placeholder={managers.length ? 'Search by name…' : 'No managers available'}
          disabled={managers.length === 0}
          value={text}
          onChange={e => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
            if (value) onChange('')
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
        <svg className="manager-select-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>

        {open && managers.length > 0 && (
          <ul id={listId} ref={listRef} role="listbox" className="manager-select-list" aria-label={label}>
            {filtered.length === 0 ? (
              <li className="manager-select-empty" role="presentation">No managers match &ldquo;{text.trim()}&rdquo;</li>
            ) : filtered.map((m, i) => (
              <li
                key={m.id}
                id={`${listId}-${m.id}`}
                data-index={i}
                role="option"
                aria-selected={m.id === value}
                className={`manager-select-option${i === active ? ' active' : ''}${m.id === value ? ' selected' : ''}`}
                // mousedown so the choice lands before the input blurs
                onMouseDown={e => { e.preventDefault(); choose(m) }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{m.name}</span>
                {m.id === value && <span className="manager-select-check">Selected</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <span id={hintId} className={`manager-select-hint${invalid ? ' error' : ''}`}>
        {managers.length === 0
          ? 'No managers in the directory yet. Ask an administrator to add them.'
          : invalid
            ? 'Choose a reporting manager from the list'
            : 'Their name and email are filled in from the manager directory'}
      </span>
    </div>
  )
}
