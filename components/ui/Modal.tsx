'use client'

import { useEffect, useId, useRef } from 'react'
import '../../styles/components/modal.css'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Dialog in the style of the HR detail page's flag modal. Closes on ESC and on a backdrop click,
// keeps Tab inside the dialog, and returns focus to whatever opened it.
export default function Modal({
  title, description, onClose, children, busy = false,
}: {
  title:        string
  description?: string
  onClose:      () => void
  children:     React.ReactNode
  busy?:        boolean   // while true, ESC and the backdrop do nothing
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId   = useId()
  const descId    = useId()

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first  = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? dialogRef.current)?.focus()
    return () => { opener?.focus?.() }
  }, [])

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      if (!busy) onClose()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter(el => el.offsetParent !== null)
    if (items.length === 0) { e.preventDefault(); return }
    const first = items[0]
    const last  = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div className="ui-modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div
        ref={dialogRef}
        className="ui-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="ui-modal-head">
          <div id={titleId} className="ui-modal-title">{title}</div>
          {description && <div id={descId} className="ui-modal-desc">{description}</div>}
        </div>
        {children}
      </div>
    </div>
  )
}
