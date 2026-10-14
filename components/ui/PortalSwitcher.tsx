'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useMe } from '@/lib/use-me'
import { portalForPath } from '@/lib/portals'
import { themeForHref } from '@/lib/portal-theme'
import PortalIcon from '@/components/ui/PortalIcon'
import '../../styles/components/portal-theme.css'
import '../../styles/components/portal-switcher.css'

// Portal switcher for accounts with more than one portal. Every entry is a plain link in natural
// tab order — no menu. The OTP session is bound to the user, not the portal, so switching never asks
// for a second code; a portal that does need one (e.g. HR without an otp_session) goes through the
// middleware's existing redirect.
//
//   variant="segmented"  a segmented control inside a portal header, right after the logo
//                        (tone="dark" on coloured headers, tone="light" on white ones)
//   variant="sidebar"    a "Portals" group of compact rows for the HR sidebar
//
// Renders nothing for single-portal accounts (and while loading, or if /api/me fails).
export default function PortalSwitcher({
  variant = 'segmented', tone = 'dark', className = '',
}: {
  variant?:   'segmented' | 'sidebar'
  tone?:      'dark' | 'light'
  className?: string
}) {
  const { me } = useMe()
  const pathname = usePathname()
  const navRef = useRef<HTMLElement>(null)

  const portals = (me?.portals ?? [])
    .map(p => ({ ...p, theme: themeForHref(p.href) }))
    .filter((p): p is typeof p & { theme: NonNullable<typeof p.theme> } => !!p.theme)
  const currentRole = portalForPath(pathname)?.role ?? null
  const visible = portals.length >= 2

  // On narrow headers the track scrolls; bring the current segment into view without moving the page
  useEffect(() => {
    if (!visible || variant !== 'segmented') return
    const nav = navRef.current
    const current = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (nav && current && nav.scrollWidth > nav.clientWidth) {
      nav.scrollLeft = Math.max(0, current.offsetLeft - 8)
    }
  }, [visible, variant, currentRole])

  if (!visible) return null

  if (variant === 'sidebar') {
    return (
      <nav className="hr-sidebar-portals" aria-label="Your portals">
        <div className="hr-nav-section">Portals</div>
        {portals.map(p => {
          const current = p.theme.role === currentRole
          return (
            <a
              key={p.href}
              href={p.href}
              className={`hr-nav-item${current ? ' active' : ''}`}
              aria-current={current ? 'page' : undefined}
            >
              <PortalIcon role={p.theme.role} />
              {p.label}
            </a>
          )
        })}
      </nav>
    )
  }

  return (
    <nav ref={navRef} className={`psw psw-${tone} ${className}`.trim()} aria-label="Your portals">
      <ul className="psw-track">
        {portals.map(p => {
          const current = p.theme.role === currentRole
          return (
            <li key={p.href}>
              <a
                href={p.href}
                className={`psw-seg${current ? ' current' : ''}`}
                data-portal={p.theme.role}
                aria-current={current ? 'page' : undefined}
                aria-label={p.label}
              >
                <PortalIcon role={p.theme.role} className="psw-icon" />
                <span className="psw-label">{p.theme.short}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
