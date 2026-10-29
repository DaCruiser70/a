import { portalForPath, portalForRole, type Role } from './portals'

// Visual identity per portal. No server imports. The same values are set as CSS variables in
// styles/components/portal-theme.css through data-portal="<role>"; keep the two in step.
//
// HR, stakeholder, payroll and onboarding reuse the colours their pages already use:
//   HR           navy #1B3A6B, darker #0f2348 (HR hero / modal gradient), tint rgba(27,58,107,0.08)
//   Stakeholder  navy #1B3A6B, darker #0f2449 (stakeholder hero gradient)
//   Payroll      teal #0F4C4A, darker #0a3332 (payroll hero gradient), tint rgba(15,76,74,0.08)
//   Onboarding   navy #1B3A6B, darker #0f2348 (form / checklist header gradient)
// HR, stakeholder and onboarding share navy, so a portal is never identified by colour alone:
// every tab, name pill and tag also carries the portal's name.
//
// Contrast (WCAG): accent on white and white on accent are 9.75:1 or more for every portal in use
// (project_mgmt 5.98:1); accent text on the soft tint is 8.56:1 or more (project_mgmt 5.17:1).

export type PortalTheme = {
  role:     Role
  label:    string   // from lib/portals.ts
  short:    string   // segment text in the portal switcher; the full label is its accessible name
  accent:   string   // fills, outlines, dots, focus rings, text on light surfaces
  hover:    string   // darker accent for hover / pressed
  soft:     string   // tint behind accent text
  heroFrom: string
  heroTo:   string
  reserved?: boolean // defined for later; not applied to any page yet
}

const theme = (role: Role, t: Omit<PortalTheme, 'role' | 'label'>): PortalTheme =>
  ({ role, label: portalForRole(role).label, ...t })

export const PORTAL_THEMES: Record<Role, PortalTheme> = {
  hr:           theme('hr',           { short: 'HR',          accent: '#1B3A6B', hover: '#0f2348', soft: 'rgba(27,58,107,0.08)', heroFrom: '#1B3A6B', heroTo: '#0f2348' }),
  stakeholder:  theme('stakeholder',  { short: 'Stakeholder', accent: '#1B3A6B', hover: '#0f2449', soft: 'rgba(27,58,107,0.08)', heroFrom: '#1B3A6B', heroTo: '#0f2449' }),
  payroll:      theme('payroll',      { short: 'Payroll',     accent: '#0F4C4A', hover: '#0a3332', soft: 'rgba(15,76,74,0.08)',  heroFrom: '#0F4C4A', heroTo: '#0a3332' }),
  newhire:      theme('newhire',      { short: 'Onboarding',  accent: '#1B3A6B', hover: '#0f2348', soft: 'rgba(27,58,107,0.08)', heroFrom: '#1B3A6B', heroTo: '#0f2348' }),
  manager:      theme('manager',      { short: 'Manager',     accent: '#4C2A85', hover: '#3B1F69', soft: '#F1ECF9',              heroFrom: '#4C2A85', heroTo: '#2E1A52' }),
  // Copper: the regional project management portal
  project_mgmt: theme('project_mgmt', { short: 'Projects',    accent: '#9A4F1D', hover: '#7A3E16', soft: '#F6EDE5',              heroFrom: '#9A4F1D', heroTo: '#5E2F10' }),
  // Deep blue-teal: the clearance reviewer's portal (bluer than payroll's green-teal).
  // White on #0E5A6E is 7.4:1; #0E5A6E on its tint #E3F0F3 is 6.6:1.
  clearance:    theme('clearance',    { short: 'Clearance',   accent: '#0E5A6E', hover: '#0A4453', soft: '#E3F0F3',              heroFrom: '#0E5A6E', heroTo: '#073340' }),
}

export function themeForRole(role: Role): PortalTheme {
  return PORTAL_THEMES[role]
}

// /api/me returns portals as { label, href }; the href identifies the portal
export function themeForHref(href: string): PortalTheme | null {
  const portal = portalForPath(href)
  return portal ? PORTAL_THEMES[portal.role] : null
}
