import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { verifyOtpSession, OTP_SESSION_COOKIE } from '@/lib/otp-session'
import { newhireSessionAllowed } from '@/lib/session-rules'
import { API_BODY_MAX_BYTES } from '@/lib/field-limits'
import {
  parseRoles, isNewhireOnly, landingRole, portalForPath, portalForRole,
} from '@/lib/portals'

// APIs that require a completed one-time-code sign-in. Every API route also
// calls requireRole(), which applies the same rule plus the role check.
const OTP_API_PREFIXES = ['/api/hr', '/api/stakeholder', '/api/payroll', '/api/manager', '/api/project-mgmt', '/api/pm', '/api/clearance']

// Same value as SET_PASSWORD_PATH in lib/password-setup.ts (server only, not imported here)
const SET_PASSWORD_PATH = '/set-password'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function matchesPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

export async function middleware(request: NextRequest) {
  // Backstop for every mutating API request: a declared body over the limit is refused before any
  // other work. Routes also check the real size while reading (lib/field-validation.ts).
  if (request.nextUrl.pathname.startsWith('/api/') && MUTATING.has(request.method)) {
    const declared = Number(request.headers.get('content-length') ?? '0')
    if (declared > API_BODY_MAX_BYTES) {
      return noStore(NextResponse.json({ error: 'That request is too large.' }, { status: 413 }))
    }
  }

  let supabaseResponse = NextResponse.next({ request })

  // SSR client — used only to validate the session JWT via getUser()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates the session with the auth server, so app_metadata is current.
  // Roles live in app_metadata (mirrored from profiles by a trigger), which users cannot write.
  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl
  const isApi = pathname.startsWith('/api')

  const roles       = user ? parseRoles(user.app_metadata?.roles) : []
  const landing     = landingRole(user?.app_metadata?.role, roles)
  const landingHref = landing ? portalForRole(landing).href : '/login'
  const otpRequired = !isNewhireOnly(roles)
  const otpValid    = user && otpRequired
    ? await verifyOtpSession(request.cookies.get(OTP_SESSION_COOKIE)?.value, user.id)
    : false
  const otpOk       = !otpRequired || otpValid

  // Signed in but holding no valid role: end the session
  if (user && roles.length === 0) {
    if (isApi && !pathname.startsWith('/api/auth')) {
      return noStore(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    if (!pathname.startsWith('/api/auth')) {
      await supabase.auth.signOut()
      const redirect = noStore(NextResponse.redirect(new URL('/login', request.url)))
      supabaseResponse.cookies.getAll().forEach(c => redirect.cookies.set(c))
      redirect.cookies.set(OTP_SESSION_COOKIE, '', { path: '/', maxAge: 0 })
      return redirect
    }
  }

  // A newhire-only session must come from a password sign-in (the verified JWT's amr claim).
  // Anything else is ended. /api/auth stays reachable so signing out and in again works.
  if (user && isNewhireOnly(roles) && !pathname.startsWith('/api/auth')) {
    const { data: claimsData } = await supabase.auth.getClaims()
    if (!newhireSessionAllowed(roles, claimsData?.claims?.amr)) {
      if (isApi) return noStore(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
      await supabase.auth.signOut()
      const redirect = noStore(NextResponse.redirect(new URL('/login', request.url)))
      supabaseResponse.cookies.getAll().forEach(c => redirect.cookies.set(c))
      return redirect
    }
  }

  // OTP-gated APIs: signed-in user with a valid otp_session bound to them
  if (matchesPrefix(pathname, OTP_API_PREFIXES)) {
    if (!user || !otpValid) {
      return noStore(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    }
    return noStore(supabaseResponse)
  }

  if (isApi) return supabaseResponse

  // The emailed set-password link works signed in or out; it never signs anyone in
  if (pathname === SET_PASSWORD_PATH) return noStore(supabaseResponse)

  // Not logged in → redirect to login (except for login itself)
  if (!user) {
    if (pathname.startsWith('/login')) return supabaseResponse
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Logged in user hitting /login → their landing portal, unless they still
  // owe a one-time code (otherwise the OTP gate below would bounce them straight back)
  if (pathname === '/login') {
    if (otpOk) return NextResponse.redirect(new URL(landingHref, request.url))
    return supabaseResponse
  }

  const portal = portalForPath(pathname)
  if (!portal) return supabaseResponse

  // Every account except a newhire-only one needs a completed one-time code
  if (!otpOk) {
    const redirectUrl = new URL('/login', request.url)
    redirectUrl.searchParams.set('otp_required', '1')
    return noStore(NextResponse.redirect(redirectUrl))
  }

  // A user may enter a portal if any of their roles allows it; otherwise send them to their landing portal
  if (!roles.includes(portal.role)) {
    return noStore(NextResponse.redirect(new URL(landingHref, request.url)))
  }

  return noStore(supabaseResponse)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
