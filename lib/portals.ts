// Roles and the portals they open. No server imports, so the edge middleware,
// API routes and browser code can all share it.

export const ROLES = ['hr', 'newhire', 'stakeholder', 'payroll', 'manager', 'project_mgmt'] as const
export type Role = typeof ROLES[number]

export type Portal = {
  role:   Role
  label:  string
  prefix: string   // every path under this prefix belongs to the portal
  href:   string   // where the portal opens
  built:  boolean  // false until the portal's pages exist; hidden from the switcher
}

// Display order in the portal switcher
export const PORTALS: Portal[] = [
  { role: 'hr',           label: 'HR Portal',                 prefix: '/hr',           href: '/hr/dashboard',           built: true  },
  { role: 'payroll',      label: 'Payroll Portal',            prefix: '/payroll',      href: '/payroll/dashboard',      built: true  },
  { role: 'stakeholder',  label: 'Stakeholder Portal',        prefix: '/stakeholder',  href: '/stakeholder/dashboard',  built: true  },
  { role: 'manager',      label: 'Manager Portal',            prefix: '/manager',      href: '/manager/dashboard',      built: false },
  { role: 'project_mgmt', label: 'Project Management Portal', prefix: '/project-mgmt', href: '/project-mgmt/dashboard', built: false },
  { role: 'newhire',      label: 'Employee Onboarding',       prefix: '/newhire',      href: '/newhire/welcome',        built: true  },
]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

// Reads a roles array from untrusted JSON (app_metadata). Unknown values are dropped.
export function parseRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(isRole))]
}

export function isNewhireOnly(roles: Role[]): boolean {
  return roles.length === 1 && roles[0] === 'newhire'
}

export function portalForRole(role: Role): Portal {
  return PORTALS.find(p => p.role === role)!
}

export function portalForPath(pathname: string): Portal | null {
  return PORTALS.find(p => pathname === p.prefix || pathname.startsWith(`${p.prefix}/`)) ?? null
}

// app_metadata.role is the landing portal; fall back to the first role if it is missing or not held
export function landingRole(role: unknown, roles: Role[]): Role | null {
  if (isRole(role) && roles.includes(role)) return role
  return roles[0] ?? null
}

// Portals the user may open from the switcher, in display order
export function portalsFor(roles: Role[]): Portal[] {
  return PORTALS.filter(p => p.built && roles.includes(p.role))
}
