'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useMe } from '@/lib/use-me'
import '../../styles/components/portal-switcher.css'

// Lets an account with more than one role move between its portals.
// The OTP session is bound to the user, not the portal, so switching never asks for a second code.
// Renders nothing for single-portal accounts (and while loading, or if /api/me fails).
export default function PortalSwitcher({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { me } = useMe()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const rootRef   = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const itemRefs  = useRef<(HTMLAnchorElement | null)[]>([])
  const menuId    = useId()

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (open) itemRefs.current[0]?.focus()
  }, [open])

  const portals = me?.portals ?? []
  if (portals.length < 2) return null

  // The current portal is the one whose first path segment matches the page
  const section = `/${pathname.split('/')[1] ?? ''}`
  const isCurrent = (href: string) => href === section || href.startsWith(`${section}/`)

  function close(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const items = itemRefs.current.filter((el): el is HTMLAnchorElement => !!el)
    const index = items.indexOf(document.activeElement as HTMLAnchorElement)
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(index + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Home')      { e.preventDefault(); items[0]?.focus() }
    else if (e.key === 'End')       { e.preventDefault(); items[items.length - 1]?.focus() }
    else if (e.key === 'Tab')       { close(false) }
  }

  return (
    <div className={`portal-switcher portal-switcher-${tone}`} ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="portal-switcher-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Switch portal"
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
        </svg>
        <span className="portal-switcher-btn-text">Switch portal</span>
        <svg className="portal-switcher-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div id={menuId} className="portal-switcher-menu" onKeyDown={onMenuKeyDown}>
          <div className="portal-switcher-menu-title">Your portals</div>
          <ul>
            {portals.map((p, i) => {
              const current = isCurrent(p.href)
              return (
                <li key={p.href}>
                  <a
                    ref={el => { itemRefs.current[i] = el }}
                    href={p.href}
                    className={`portal-switcher-item${current ? ' current' : ''}`}
                    aria-current={current ? 'page' : undefined}
                  >
                    <span>{p.label}</span>
                    {current && <span className="portal-switcher-current">Current</span>}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
