import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import { issueLoginCode, setPendingSession, devOtpEnabled } from '@/lib/otp-issue'
import { accountRegion, activeRegionMembers } from '@/lib/pm-server'
import { maskEmail } from '@/lib/pm'
import { landingHref } from '@/lib/portals'

const WINDOW_SECONDS  = 15 * 60

const BodySchema = z.strictObject({
  email:    z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(256),
})

const INVALID_CREDENTIALS = 'Invalid email or password.'

function invalid() {
  return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 })
}

// Shared project-management account with no usable team: one generic answer for every cause
function signInUnavailable() {
  return NextResponse.json({ error: 'Sign-in could not be completed. Please contact HR.' }, { status: 401 })
}

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  )
}

export async function POST(request: Request) {
  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { email, password } = parsed.data

  const [ipLimit, emailLimit] = await Promise.all([
    rateLimit(await rateLimitKey('login:ip', getClientIp(request)), 20, WINDOW_SECONDS),
    rateLimit(await rateLimitKey('login:email', email), 5, WINDOW_SECONDS),
  ])
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return tooMany(Math.max(
      ipLimit.allowed    ? 0 : ipLimit.retryAfterSeconds,
      emailLimit.allowed ? 0 : emailLimit.retryAfterSeconds,
    ))
  }

  // Dedicated sign-in client — anon key, no session persistence.
  // signInWithPassword sets the user JWT as the active session on whichever
  // client instance it runs on, so we never run it on the service-role client.
  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({ email, password })
  if (authError || !authData.user || !authData.session) return invalid()

  const userId = authData.user.id
  const admin  = createServiceClient()

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, role, roles')
    .eq('id', userId)
    .maybeSingle()

  if (profileError) console.error(`[login] profile lookup failed (code ${profileError.code})`)
  if (!profile) return invalid()

  const roles = Array.isArray(profile.roles) ? profile.roles : []
  if (roles.length === 0) return invalid()

  if (roles.length === 1 && roles[0] === 'newhire') {
    // Newhire: session is ready, no OTP needed
    return NextResponse.json({ role: 'newhire', session: authData.session, landing: landingHref('newhire', ['newhire']) })
  }

  // Shared regional project-management account: show the region's active team (names, masked
  // emails) and wait for the person to pick themselves; the code then goes to that member.
  if (roles.includes('project_mgmt')) {
    const region  = await accountRegion(admin, userId)
    const members = region ? await activeRegionMembers(admin, region) : []
    // No region or an empty team: fail closed with the same generic answer
    if (members.length === 0) return signInUnavailable()

    await setPendingSession({
      access_token:    authData.session.access_token,
      refresh_token:   authData.session.refresh_token,
      user_id:         userId,
      awaiting_member: true,
    })
    return NextResponse.json({
      requiresMember: true,
      members: members.map(m => ({ id: m.id, name: m.member_name, email: maskEmail(m.member_email) })),
    })
  }

  // Everyone else: one-time code to the account's own address. Only its HMAC is stored.
  const issued = await issueLoginCode(admin, userId, null)
  if (!issued.ok) return NextResponse.json({ error: 'Sign in failed. Please try again.' }, { status: 500 })

  // Tokens are held encrypted in a short-lived cookie until the code is verified
  await setPendingSession({
    access_token:  authData.session.access_token,
    refresh_token: authData.session.refresh_token,
    user_id:       userId,
  })

  return NextResponse.json({
    role:        profile.role,
    requiresOtp: true,
    ...(devOtpEnabled() ? { devCode: issued.code } : {}),
  })
}
