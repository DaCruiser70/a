import type { Role } from '@/lib/portals'

// Decorative portal icons in the app's existing line style (stroke 2, round caps).
const PATHS: Record<Role, React.ReactNode> = {
  // shield
  hr: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
  // clipboard with a check
  stakeholder: (
    <>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1"/>
      <polyline points="9 14 11 16 15 12"/>
    </>
  ),
  // two people
  manager: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </>
  ),
  // wallet
  payroll: (
    <>
      <path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/>
      <path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/>
      <path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>
    </>
  ),
  // house (employee onboarding)
  newhire: (
    <>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </>
  ),
  // shield with a check (clearance review)
  clearance: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <polyline points="9 12 11 14 15 10"/>
    </>
  ),
  // briefcase (reserved: project management)
  project_mgmt: (
    <>
      <rect x="2" y="7" width="20" height="14" rx="2"/>
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
    </>
  ),
}

export default function PortalIcon({ role, className }: { role: Role; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
    >
      {PATHS[role]}
    </svg>
  )
}
