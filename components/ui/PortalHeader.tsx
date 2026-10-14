'use client'

import Image from 'next/image'
import Link from 'next/link'
import '../../styles/components/portal-theme.css'
import '../../styles/components/portal-header.css'
import { useMe } from '@/lib/use-me'
import { PortalIdentity } from '@/components/ui/PortalName'
import type { Role } from '@/lib/portals'

function getInitials(name: string) {
  return name.split(' ').filter(Boolean).map(n => n[0]).join('').toUpperCase().slice(0, 2)
}

async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  window.location.href = '/login'
}

// Shared top bar for the coloured portals (manager, stakeholder, payroll): logo badge, portal
// switcher (or the portal name for single-portal accounts), the user's name and avatar, Sign out.
// Background is the portal's accent from portal-theme.css; height and spacing match the old bars.
//
// The logo links to "/", which the app sends on to the signed-in user's landing portal.
export default function PortalHeader({
  portal, back,
}: {
  portal: Role
  back?:  { href: string; label: string }
}) {
  const { me } = useMe()
  const name = me?.name ?? ''

  return (
    <header className="portal-header" data-portal={portal}>
      <div className="ph-left">
        <Link href="/" className="ph-logo-link" aria-label="AEM home">
          {/* /logo.png is an opaque JPEG; the white badge keeps it readable on any header colour */}
          <Image src="/logo.png" alt="AEM" width={73} height={28} className="ph-logo" priority />
        </Link>
        <PortalIdentity role={portal} tone="dark" />
      </div>

      <div className="ph-right">
        {back && (
          <Link href={back.href} className="ph-btn" aria-label={`Back to ${back.label}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            <span className="ph-btn-text">{back.label}</span>
          </Link>
        )}
        {name && (
          <div className="ph-user">
            <div className="ph-avatar" aria-hidden="true">{getInitials(name)}</div>
            <span className="ph-name">{name}</span>
          </div>
        )}
        <button type="button" className="ph-btn" onClick={signOut} aria-label="Sign out">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span className="ph-btn-text">Sign out</span>
        </button>
      </div>
    </header>
  )
}
