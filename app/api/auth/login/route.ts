import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import { issueLoginCode, setPendingSession, devOtpEnabled } from '@/lib/otp-issue'
import { CODE_SEND_FAILED } from '@/lib/code-delivery'
import { accountRegion, activeRegionMembers } from '@/lib/pm-server'
import { maskEmail } from '@/lib/pm'
import { landingHref } from '@/lib/portals'
import { FIELD_LIMITS } from '@/lib/field-limits'
import {
  staffPasswordLoginOn, passwordSignInAllowed, BREAK_GLASS_AUDIT_MESSAGE, PASSWORD_OFF_AUDIT_MESSAGE,
} from '@/lib/microsoft-auth'

const WINDOW_SECONDS  = 15 * 60

const BodySchema = z.strictObject({
  email:    z.string().trim().toLowerCase().max(FIELD_LIMITS.email).pipe(z.email()),
  // Never trimmed or changed; only a length cap (lib/field-limits.ts). Supabase itself refuses
  // passwords over 72 characters, so no existing password is affected.
  password: z.string().min(1).max(FIELD_LIMITS.password),
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

// Staff password sign-in while STAFF_PASSWORD_LOGIN is off: a refusal or a break-glass sign-in,
// in sign_in_events and on the account's own audit trail (fixed text, no personal data)
async function recordPasswordEvent(admin: ReturnType<typeof createServiceClient>, userId: string, outcome: 'refused' | 'break_glass') {
  const { error } = await admin.from('sign_in_events').insert({
    method: 'password', outcome, reason: outcome === 'refused' ? 'password_off' : null, user_id: userId,
  })
  if (error) console.error(`[login] event insert failed (code ${error.code})`)
  const { error: auditError } = await admin.from('audit_log').insert({
    user_id: userId, performed_by: userId, action_type: outcome === 'refused' ? 'amber' : 'red',
    message: outcome === 'refused' ? PASSWORD_OFF_AUDIT_MESSAGE : BREAK_GLASS_AUDIT_MESSAGE,
  })
  if (auditError) console.error(`[login] audit insert failed (code ${auditError.code})`)
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

  // STAFF_PASSWORD_LOGIN=off (go-live): staff sign in with Microsoft; a password works only for a
  // named break-glass account. Everyone else gets the usual generic answer, and the password
  // session that was just created is ended. New hires never reach this point.
  const settingOn = staffPasswordLoginOn(process.env.STAFF_PASSWORD_LOGIN)
  if (!settingOn) {
    const { data: flag, error: flagError } = await admin
      .from('staff_login_flags').select('break_glass').eq('user_id', userId).maybeSingle()
    if (flagError) console.error(`[login] break-glass lookup failed (code ${flagError.code})`)
    const decision = passwordSignInAllowed({ roles, settingOn, breakGlass: flag?.break_glass === true })
    if (!decision.allow) {
      await admin.auth.admin.signOut(authData.session.access_token, 'local')
      await recordPasswordEvent(admin, userId, 'refused')
      return invalid()
    }
    await recordPasswordEvent(admin, userId, 'break_glass')
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
  if (!issued.ok) {
    return issued.reason === 'send_failed'
      ? NextResponse.json({ error: CODE_SEND_FAILED }, { status: 503 })
      : NextResponse.json({ error: 'Sign in failed. Please try again.' }, { status: 500 })
  }

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
