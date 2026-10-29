import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { readOtpSession, OTP_SESSION_COOKIE } from '@/lib/otp-session'
import { parseRoles, isNewhireOnly, type Role } from '@/lib/portals'
import { loadAccountMember, type PmMember } from '@/lib/pm-server'

export { ROLES, type Role } from '@/lib/portals'

// member: the regional team member signed in on a shared project-management account (from the
// signed otp_session); null for every other account. Attribute project-management actions to it.
export type RoleAuth = { user: User; roles: Role[]; member: PmMember | null }

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
}

function forbidden() {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
}

// Gate for every API route:
//   const auth = await requireRole('hr'); if (auth instanceof NextResponse) return auth
// Roles come only from app_metadata, which users cannot write. Everyone except a
// newhire-only account also needs a valid otp_session bound to them. The second
// factor is checked before the role, so role membership is never revealed without it.
// When the caller gets in only as project_mgmt, the session must also name an active member of
// the account's region, which is returned as `member`.
export async function requireRole(...allowed: Role[]): Promise<RoleAuth | NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized()

  const roles = parseRoles(user.app_metadata?.roles)
  if (roles.length === 0) return forbidden()

  let memberId: string | null = null
  if (!isNewhireOnly(roles)) {
    const cookieStore = await cookies()
    const session = await readOtpSession(cookieStore.get(OTP_SESSION_COOKIE)?.value, user.id)
    if (!session.valid) return unauthorized()
    memberId = session.memberId
  }

  if (!roles.some(r => allowed.includes(r))) return forbidden()

  // Entering through project_mgmt (and no other allowed role) needs a signed-in team member
  const onlyViaPm = roles.includes('project_mgmt') && allowed.includes('project_mgmt')
    && !roles.some(r => r !== 'project_mgmt' && allowed.includes(r))
  let member: PmMember | null = null
  if (roles.includes('project_mgmt') && memberId) {
    member = await loadAccountMember(createServiceClient(), user.id, memberId)
  }
  if (onlyViaPm && !member) return unauthorized()

  return { user, roles, member }
}
