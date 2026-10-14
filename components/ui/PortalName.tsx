'use client'

import { useEffect } from 'react'
import '../../styles/components/portal-theme.css'
import { themeForRole } from '@/lib/portal-theme'
import { useMe } from '@/lib/use-me'
import PortalSwitcher from '@/components/ui/PortalSwitcher'
import type { Role } from '@/lib/portals'

// Sets the browser tab title for a portal, e.g. "Manager Portal | AEM"
export function usePortalTitle(role: Role) {
  const label = themeForRole(role).label
  useEffect(() => {
    document.title = `${label} | AEM`
  }, [label])
}

// The current portal's name in its accent colour. The name is always written out,
// so colour is never the only cue.
export function PortalName({ role, onDark = false }: { role: Role; onDark?: boolean }) {
  usePortalTitle(role)
  const theme = themeForRole(role)
  return (
    <span className={`portal-name${onDark ? ' on-dark' : ''}`} data-portal={role}>
      <span className="portal-name-dot" aria-hidden="true" />
      {theme.label}
    </span>
  )
}

// What sits next to the logo: the segmented portal switcher for accounts with two or more portals
// (its current segment names the portal), otherwise the standalone portal-name pill.
//   hrTopbar  HR keeps the pill on wide screens, where the switcher lives in the sidebar, and swaps
//             to the segmented switcher only where the sidebar is hidden (≤ 768px).
export function PortalIdentity({
  role, tone = 'dark', hrTopbar = false,
}: { role: Role; tone?: 'dark' | 'light'; hrTopbar?: boolean }) {
  usePortalTitle(role)
  const { me } = useMe()
  const multi = (me?.portals?.length ?? 0) >= 2
  const pill = <PortalName role={role} onDark={tone === 'dark'} />

  if (!multi) return pill
  if (hrTopbar) {
    return (
      <>
        <span className="hide-below-768">{pill}</span>
        <PortalSwitcher tone={tone} className="psw-below-768" />
      </>
    )
  }
  return <PortalSwitcher tone={tone} />
}

// Small tag that ties something back to a portal by colour and name (e.g. "Manager" on HR's plan card)
export function PortalTag({ role, children }: { role: Role; children: React.ReactNode }) {
  return (
    <span className="portal-tag" data-portal={role}>
      <span className="portal-name-dot" aria-hidden="true" />
      {children}
    </span>
  )
}
