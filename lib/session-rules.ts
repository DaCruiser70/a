// Session rules shared by the edge middleware and requireRole. No server imports.

import { isNewhireOnly, type Role } from '@/lib/portals'

// True when the session's authentication methods (the verified JWT's amr claim) include a password
// sign-in. Supabase writes [{ method: 'password', timestamp }]; the plain-string form is accepted too.
export function sessionFromPassword(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false
  return amr.some(entry =>
    entry === 'password' || entry === 'pwd' ||
    (!!entry && typeof entry === 'object' && (entry as { method?: unknown }).method === 'password'))
}

// New hires only ever sign in with their password (the New hire tab). A newhire-only session
// created any other way, for example a Microsoft sign-in run outside our button, is refused.
// Staff sessions are unaffected here: they are gated by the signed otp_session cookie instead.
export function newhireSessionAllowed(roles: Role[], amr: unknown): boolean {
  return !isNewhireOnly(roles) || sessionFromPassword(amr)
}
