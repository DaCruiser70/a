import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { verifyOtpSession, OTP_SESSION_COOKIE } from '@/lib/otp-session'
import { parseRoles, isNewhireOnly, type Role } from '@/lib/portals'

export { ROLES, type Role } from '@/lib/portals'

export type RoleAuth = { user: User; roles: Role[] }

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
export async function requireRole(...allowed: Role[]): Promise<RoleAuth | NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return unauthorized()

  const roles = parseRoles(user.app_metadata?.roles)
  if (roles.length === 0) return forbidden()

  if (!isNewhireOnly(roles)) {
    const cookieStore = await cookies()
    const otpValid = await verifyOtpSession(cookieStore.get(OTP_SESSION_COOKIE)?.value, user.id)
    if (!otpValid) return unauthorized()
  }

  if (!roles.some(r => allowed.includes(r))) return forbidden()

  return { user, roles }
}
