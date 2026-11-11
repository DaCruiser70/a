// Microsoft (Entra ID) sign-in for staff: the decision rules, with no server imports so they can be
// unit-tested without a real Microsoft login (scripts/test-microsoft-login.ts).
//
// Microsoft only proves who the person is. Whether they get in, and as what, comes only from our
// database: one active staff account with that email, or else one active project-management team
// member (region_teams) with that email, and (after the first sign-in) the same immutable Microsoft
// id every time. Nothing here ever creates an account, a profile, a team member or a role.

import { PORTALS, isRole, type Role } from '@/lib/portals'

// Work domains that may sign in with Microsoft (compared trimmed and lower-case)
export const MICROSOFT_ALLOWED_DOMAINS = ['aemltd.com', 'advancedenergymanagement.com'] as const

// The single message a person ever sees when a Microsoft sign-in is refused, whatever the reason
export const MICROSOFT_REFUSED_MESSAGE = 'Your Microsoft account is not set up for this portal yet. Please contact HR.'

// Roles a staff account may hold to sign in with Microsoft. Newhire never. A shared regional
// project-management account is never signed in to directly: its members sign in as themselves.
export const MICROSOFT_STAFF_ROLES: readonly Role[] = ['hr', 'stakeholder', 'payroll', 'manager', 'project_mgmt', 'clearance']

export const PM_REGIONS = ['Ontario', 'New Brunswick', 'Nova Scotia'] as const

// Short reason codes for sign_in_events and the audit log. No personal data.
export const REFUSAL_REASONS = [
  'bad_request',      // missing code, provider error, expired or replayed start
  'rate_limit',
  'bad_claims',       // no email or no stable Microsoft id in the identity
  'domain',
  'unverified',       // Microsoft says the email is not verified
  'no_account',
  'ambiguous',        // more than one account, or a team member active in more than one region
  'inactive',
  'newhire',
  'wrong_role',
  'pm_shared',        // the shared project-management account itself (members sign in as themselves)
  'no_pm_account',    // the member's region has no single active shared account to sign in on
  'id_mismatch',
  'error',            // our side failed; nothing was granted
] as const
export type RefusalReason = typeof REFUSAL_REASONS[number]

// Recorded alongside the outcome: the email matched a staff account AND a team member; the staff
// account was used (allowed or refused) and the member row was not
export const STAFF_OVER_MEMBER = 'staff_over_member'

export type MicrosoftClaims = {
  email:         string | null   // from the Microsoft identity, not from our user record
  subject:       string | null   // the provider's stable subject id for this user and app
  issuer:        string | null   // the token issuer (identifies the Entra tenant)
  emailVerified: boolean | null  // null when the provider did not say
}

export type AccountCandidate = { id: string; roles: string[]; active: boolean }
export type MemberCandidate  = { id: string; region: string; active: boolean }

// Who a stored Microsoft id belongs to: a staff account (profiles) or a team member (region_teams)
export type BindingOwner     = { kind: 'profile' | 'member'; id: string }
export type MicrosoftBinding = { owner: BindingOwner; subject: string; issuer: string }

export type MicrosoftDecision =
  | { allow: true;  kind: 'account'; userId: string; bindNow: boolean; alsoMember: boolean }
  | { allow: true;  kind: 'member';  memberId: string; region: string; bindNow: boolean }
  | { allow: false; reason: RefusalReason; userId: string | null; memberId: string | null; alsoMember: boolean }

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  if (email.length < 3 || email.length > 254 || /\s/.test(email)) return null
  const at = email.lastIndexOf('@')
  if (at <= 0 || at !== email.indexOf('@') || at === email.length - 1) return null
  return email
}

export function emailDomainAllowed(email: string | null): boolean {
  if (!email) return false
  const domain = email.slice(email.lastIndexOf('@') + 1)
  return (MICROSOFT_ALLOWED_DOMAINS as readonly string[]).includes(domain)
}

export const sameOwner = (a: BindingOwner, b: BindingOwner) => a.kind === b.kind && a.id === b.id

// ── Project-management members ──

// A member signs in as themselves: exactly one ACTIVE region_teams row with their email. The region
// comes from that row only. Active in two regions is ambiguous; only inactive rows is inactive.
export function resolvePmMember(email: string | null, rows: (MemberCandidate & { member_email?: string })[]):
  { ok: true; memberId: string; region: string } | { ok: false; reason: 'no_account' | 'ambiguous' | 'inactive' } {
  const wanted = normalizeEmail(email)
  if (!wanted) return { ok: false, reason: 'no_account' }
  // Rows from the database are already matched on email; test rows may carry member_email
  const mine = rows.filter(r => r.member_email === undefined || normalizeEmail(r.member_email) === wanted)
  const active = mine.filter(r => r.active && (PM_REGIONS as readonly string[]).includes(r.region))
  if (active.length > 1) return { ok: false, reason: 'ambiguous' }
  if (active.length === 1) return { ok: true, memberId: active[0].id, region: active[0].region }
  return { ok: false, reason: mine.length > 0 ? 'inactive' : 'no_account' }
}

// ── The decision ──

// candidates: every account whose email matches (any role, active or not).
// members: every region_teams row whose email matches (active or not).
// bindings: the stored Microsoft ids for those accounts and members, and for this Microsoft id.
export function decideMicrosoftSignIn(input: {
  claims:     MicrosoftClaims
  candidates: AccountCandidate[]
  members:    MemberCandidate[]
  bindings:   MicrosoftBinding[]
}): MicrosoftDecision {
  const { claims, candidates, members, bindings } = input
  const email   = normalizeEmail(claims.email)
  const subject = typeof claims.subject === 'string' && claims.subject.trim() ? claims.subject.trim() : null
  const issuer  = typeof claims.issuer === 'string' && claims.issuer.trim() ? claims.issuer.trim() : null
  const refuse = (reason: RefusalReason, userId: string | null = null, memberId: string | null = null, alsoMember = false): MicrosoftDecision =>
    ({ allow: false, reason, userId, memberId, alsoMember })

  if (!email || !subject || !issuer) return refuse('bad_claims')
  if (!emailDomainAllowed(email))     return refuse('domain')
  if (claims.emailVerified === false) return refuse('unverified')

  // The stored-id check, the same for both kinds of owner
  const idCheck = (owner: BindingOwner): 'ok' | 'bind' | 'mismatch' => {
    const forSubject = bindings.find(b => b.subject === subject && b.issuer === issuer)
    if (forSubject && !sameOwner(forSubject.owner, owner)) return 'mismatch'
    const forOwner = bindings.find(b => sameOwner(b.owner, owner))
    if (!forOwner) return 'bind'
    return forOwner.subject === subject && forOwner.issuer === issuer ? 'ok' : 'mismatch'
  }

  // 1. A staff account with this email always wins over a team member with the same email
  if (candidates.length > 0) {
    const alsoMember = members.some(m => m.active)
    if (candidates.length > 1) return refuse('ambiguous', null, null, alsoMember)
    const account = candidates[0]
    const roles   = account.roles.filter(isRole)
    if (!account.active) return refuse('inactive', account.id, null, alsoMember)
    if (roles.includes('newhire')) return refuse('newhire', account.id, null, alsoMember)
    if (!roles.some(r => MICROSOFT_STAFF_ROLES.includes(r))) return refuse('wrong_role', account.id, null, alsoMember)
    if (roles.every(r => r === 'project_mgmt')) return refuse('pm_shared', account.id, null, alsoMember)
    const id = idCheck({ kind: 'profile', id: account.id })
    if (id === 'mismatch') return refuse('id_mismatch', account.id, null, alsoMember)
    return { allow: true, kind: 'account', userId: account.id, bindNow: id === 'bind', alsoMember }
  }

  // 2. Otherwise a project-management team member, as themselves, in their own region only
  const member = resolvePmMember(email, members)
  if (!member.ok) return refuse(member.reason)
  const id = idCheck({ kind: 'member', id: member.memberId })
  if (id === 'mismatch') return refuse('id_mismatch', null, member.memberId)
  return { allow: true, kind: 'member', memberId: member.memberId, region: member.region, bindNow: id === 'bind' }
}

// The shared account a member's session is created on: exactly one active account for the region
export function pickPmAccount(rows: { id: string; active: boolean }[]): string | null {
  return rows.length === 1 && rows[0].active ? rows[0].id : null
}

// ── Staff password sign-in setting ──

// STAFF_PASSWORD_LOGIN: 'off' turns staff password sign-in off. Anything else, or unset, is on.
export function staffPasswordLoginOn(value: string | undefined | null): boolean {
  return (value ?? '').trim().toLowerCase() !== 'off'
}

// New hires are never affected. With the setting off, only break-glass accounts may use a password.
export function passwordSignInAllowed(input: { roles: string[]; settingOn: boolean; breakGlass: boolean }):
  { allow: true; breakGlassUsed: boolean } | { allow: false } {
  const roles = input.roles.filter(isRole)
  if (roles.length === 1 && roles[0] === 'newhire') return { allow: true, breakGlassUsed: false }
  if (input.settingOn) return { allow: true, breakGlassUsed: false }
  return input.breakGlass ? { allow: true, breakGlassUsed: true } : { allow: false }
}

// ── After sign-in: only our own portal pages ──

// Same-origin paths from a fixed allow-list (each portal's home). Anything else, including full
// URLs, protocol-relative URLs and backslash tricks, falls back to the account's landing page.
export function safeRedirectPath(candidate: unknown, fallback: string): string {
  const allowed = PORTALS.map(p => p.href)
  const safeFallback = allowed.includes(fallback) ? fallback : '/login'
  if (typeof candidate !== 'string') return safeFallback
  return allowed.includes(candidate) ? candidate : safeFallback
}

// ── Audit text: fixed phrases and a reason code only ──

export function microsoftAuditMessage(outcome: 'success' | 'success_member' | typeof STAFF_OVER_MEMBER | RefusalReason): string {
  switch (outcome) {
    case 'success':           return 'Signed in with Microsoft'
    case 'success_member':    return 'Project management team member signed in with Microsoft'
    case STAFF_OVER_MEMBER:   return 'Microsoft sign-in used the staff account; the same email is also on a project management team (staff_over_member)'
    case 'id_mismatch':       return 'Microsoft sign-in refused: the Microsoft account id did not match (security event, id_mismatch)'
    default:                  return `Microsoft sign-in refused (${outcome})`
  }
}

export const BREAK_GLASS_AUDIT_MESSAGE = 'Break-glass password sign-in (staff password sign-in is off)'
export const PASSWORD_OFF_AUDIT_MESSAGE = 'Password sign-in refused: staff password sign-in is off (password_off)'
