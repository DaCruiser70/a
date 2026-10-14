'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import '../../styles/components/manager-select.css'

type ManagerOption = { id: string; name: string }

const GAP         = 4    // px between the input and the list
const EDGE        = 16   // px kept clear of the viewport edges (16px each side at 375px wide)
const MAX_HEIGHT  = 280  // px; the list scrolls inside this

// Ancestors that can actually clip the input. The walk stops at the first position: fixed ancestor
// (a modal overlay): boxes above it do not clip it, even with overflow: hidden. Without that stop,
// a modal rendered inside an overflow: hidden card (the HR "Manager Plan" card) looked "out of view".
function clippingAncestors(el: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) out.push(node)
    if (style.position === 'fixed') break
  }
  return out
}

function inputOutOfView(input: HTMLElement): boolean {
  const rect = input.getBoundingClientRect()
  if (rect.bottom < 0 || rect.top > window.innerHeight) return true
  return clippingAncestors(input).some(a => {
    const r = a.getBoundingClientRect()
    return rect.bottom <= r.top || rect.top >= r.bottom
  })
}

// Searchable, required dropdown over the manager directory (GET /api/hr/managers).
// Only the selected id leaves this component; the server copies the name and email.
//
// The open list is portaled to document.body with position: fixed (the modals here are plain
// elements, not native <dialog>s, so nothing sits in the top layer above it), so no modal's
// overflow, transform or stacking context can clip it. Focus never leaves the input (options are
// reached through aria-activedescendant), so the surrounding modal's focus trap is unaffected.
// React events from the portal still bubble through this component, so a click on the list never
// reaches a modal's backdrop-close handler; Escape is stopped here while the list is open.
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

  const inputId    = useId()
  const listId     = useId()
  const hintId     = useId()
  const controlRef = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const listRef    = useRef<HTMLUListElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/hr/managers?limit=100', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((data: { managers?: ManagerOption[] }) => {
        if (cancelled) return
        const list = Array.isArray(data.managers) ? data.managers : []
        setManagers([...list].sort((a, b) => a.name.localeCompare(b.name)))
        setStatus('ready')
      })
      // 401 / 403 / 5xx / network: friendly error with a retry
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [attempt])

  const loading  = status === 'loading'
  const failed   = status === 'error'
  const selected = managers.find(m => m.id === value) ?? null
  const text     = query ?? selected?.name ?? ''
  const filtered = query === null
    ? managers
    : managers.filter(m => m.name.toLowerCase().includes(query.trim().toLowerCase()))
  const activeIndex = Math.min(active, Math.max(filtered.length - 1, 0))
  const noManagers  = status === 'ready' && managers.length === 0

  function retry() {
    setStatus('loading')
    setAttempt(a => a + 1)
  }

  function choose(m: ManagerOption) {
    onChange(m.id)
    setQuery(null)
    setOpen(false)
  }

  // Opening shows the full list (unless the user is mid-filter) with the current choice highlighted
  function openList() {
    if (noManagers) return
    const current = (query === null ? managers : filtered).findIndex(m => m.id === value)
    setActive(current >= 0 ? current : 0)
    setOpen(true)
  }

  function clear() {
    onChange('')
    setQuery(null)
    setActive(0)
    inputRef.current?.focus()
    setOpen(true)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const last = filtered.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) { openList(); return }
        setActive(Math.min(activeIndex + 1, last))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!open) { openList(); return }
        setActive(Math.max(activeIndex - 1, 0))
        break
      case 'Home':
        if (open) { e.preventDefault(); setActive(0) }
        break
      case 'End':
        if (open) { e.preventDefault(); setActive(Math.max(last, 0)) }
        break
      case 'Enter':
        if (failed) { e.preventDefault(); retry(); return }
        if (open && !loading && filtered[activeIndex]) { e.preventDefault(); choose(filtered[activeIndex]) }
        break
      case 'Escape':
        // The list closes first; with the list closed, Escape reaches the modal as before
        if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false) }
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

  function onBlur() {
    setOpen(false)
    // Free text never counts as a choice: snap back to the selected name, or clear
    setQuery(null)
  }

  // ── Positioning: fixed, under the input (or above it when there is more room there) ──
  // Only measures and places; it never decides to close the list.
  const place = useCallback(() => {
    const input = inputRef.current
    const list  = listRef.current
    if (!input || !list) return

    const rect = input.getBoundingClientRect()
    const vw   = document.documentElement.clientWidth
    const vh   = window.innerHeight

    const width = Math.min(rect.width, vw - EDGE * 2)
    const left  = Math.min(Math.max(rect.left, EDGE), vw - EDGE - width)

    const needed = Math.min(list.scrollHeight, MAX_HEIGHT)
    const below  = vh - rect.bottom - GAP - EDGE
    const above  = rect.top - GAP - EDGE
    const downwards = below >= needed || below >= above

    const s = list.style
    s.left      = `${left}px`
    s.width     = `${width}px`
    s.maxHeight = `${Math.max(Math.min(MAX_HEIGHT, downwards ? below : above), 0)}px`
    if (downwards) { s.top = `${rect.bottom + GAP}px`; s.bottom = '' }
    else           { s.bottom = `${vh - rect.top + GAP}px`; s.top = '' }
    list.dataset.placement = downwards ? 'below' : 'above'
  }, [])

  // On open and whenever the contents change size: place before paint. No visibility check here.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place, filtered.length, status])

  // After the list has opened: follow the input on resize and scroll, and close it only when a
  // scroll or resize actually moves the input out of view.
  useEffect(() => {
    if (!open) return
    let frame = 0
    const onMove = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const input = inputRef.current
        if (input && inputOutOfView(input)) setOpen(false)
        else place()
      })
    }
    const vv = window.visualViewport // on-screen keyboards resize this, not the window
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    vv?.addEventListener('resize', onMove)
    vv?.addEventListener('scroll', onMove)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
      vv?.removeEventListener('resize', onMove)
      vv?.removeEventListener('scroll', onMove)
    }
  }, [open, place])

  // A press outside the control (input + buttons) and the list closes it
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (controlRef.current?.contains(target) || listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  // Keep the highlighted option in view inside the list (without scrolling the page or the modal)
  useEffect(() => {
    if (!open) return
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    if (!list || !item) return
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight
    }
  }, [activeIndex, open])

  const activeId = open && status === 'ready' && filtered[activeIndex] ? `${listId}-${filtered[activeIndex].id}` : undefined

  const list = open && typeof document !== 'undefined' ? createPortal(
    <ul
      id={listId}
      ref={listRef}
      role="listbox"
      aria-label={label}
      aria-busy={loading || undefined}
      className="manager-select-list"
      // Keep focus on the input, including when the scrollbar is pressed
      onMouseDown={e => e.preventDefault()}
    >
      {loading ? (
        <li className="manager-select-status" role="presentation">
          <span className="manager-select-spinner" aria-hidden="true" />
          Loading managers…
        </li>
      ) : failed ? (
        <li className="manager-select-status error" role="presentation">
          We couldn&apos;t load the manager list.
          <button type="button" className="manager-select-retry" tabIndex={-1} onClick={retry}>Retry</button>
        </li>
      ) : filtered.length === 0 ? (
        <li className="manager-select-status" role="presentation">No managers match &ldquo;{text.trim()}&rdquo;</li>
      ) : filtered.map((m, i) => (
        <li
          key={m.id}
          id={`${listId}-${m.id}`}
          data-index={i}
          role="option"
          aria-selected={m.id === value}
          className={`manager-select-option${i === activeIndex ? ' active' : ''}${m.id === value ? ' selected' : ''}`}
          onClick={() => choose(m)}
          onMouseEnter={() => setActive(i)}
        >
          <span>{m.name}</span>
          {m.id === value && <span className="manager-select-check">Selected</span>}
        </li>
      ))}
    </ul>,
    document.body,
  ) : null

  return (
    <div className="manager-select">
      <label className="manager-select-label" htmlFor={inputId}>
        {label} <span className="manager-select-req" aria-hidden="true">*</span>
      </label>
      <div className="manager-select-control" ref={controlRef}>
        <input
          ref={inputRef}
          id={inputId}
          className={`manager-select-input${invalid ? ' invalid' : ''}${value ? ' has-value' : ''}`}
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
          placeholder={loading ? 'Loading managers…' : noManagers ? 'No managers available' : 'Search by name…'}
          disabled={noManagers}
          value={text}
          onChange={e => {
            setQuery(e.target.value)
            setActive(0)
            setOpen(true)
            if (value) onChange('')
          }}
          onFocus={openList}
          onClick={() => { if (!open) openList() }}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />

        {value && (
          <button
            type="button"
            className="manager-select-clear"
            aria-label="Clear manager"
            onMouseDown={e => e.preventDefault()}  // keep focus on the input
            onClick={clear}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}

        <button
          type="button"
          className="manager-select-toggle"
          aria-label="Show managers"
          aria-expanded={open}
          aria-controls={listId}
          tabIndex={-1}               // keyboard users open the list with the arrow keys
          disabled={noManagers}
          onMouseDown={e => e.preventDefault()}  // keep focus on the input
          onClick={() => {
            if (open) { setOpen(false); return }
            inputRef.current?.focus()
            openList()
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
      </div>
      {list}
      <span id={hintId} className={`manager-select-hint${invalid || failed ? ' error' : ''}`}>
        {failed ? (
          <>
            We couldn&apos;t load the manager list.{' '}
            <button type="button" className="manager-select-retry inline" onClick={retry}>Try again</button>
          </>
        ) : noManagers
          ? 'No managers in the directory yet. Ask an administrator to add them.'
          : invalid
            ? 'Choose a reporting manager from the list'
            : 'Their name and email are filled in from the manager directory'}
      </span>
    </div>
  )
}
