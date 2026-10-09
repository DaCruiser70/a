import { NextResponse } from 'next/server'
import { randomInt } from 'node:crypto'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { encrypt } from '@/lib/encrypt'
import { hmacHex } from '@/lib/auth-secrets'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import { getOtpRecipients } from '@/lib/otp-recipients'
import { PENDING_SESSION_COOKIE, PENDING_SESSION_PATH } from '@/lib/otp-session'

const OTP_TTL_SECONDS = 300
const WINDOW_SECONDS  = 15 * 60

const BodySchema = z.strictObject({
  email:    z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(256),
})

const INVALID_CREDENTIALS = 'Invalid email or password.'

function invalid() {
  return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 })
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
    return NextResponse.json({ role: 'newhire', session: authData.session })
  }

  // Everyone else: one-time code. Only its HMAC is stored.
  const code      = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const codeHash  = await hmacHex('otp-code', `${userId}:${code}`)
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString()

  const { error: deleteError } = await admin
    .from('otp_codes')
    .delete()
    .eq('user_id', userId)
    .or(`used.eq.true,expires_at.lt.${new Date().toISOString()}`)
  if (deleteError) console.error(`[login] stale code cleanup failed (code ${deleteError.code})`)

  const { error: invalidateError } = await admin
    .from('otp_codes')
    .update({ used: true })
    .eq('user_id', userId)
    .eq('used', false)
  if (invalidateError) {
    console.error(`[login] code invalidation failed (code ${invalidateError.code})`)
    return NextResponse.json({ error: 'Sign in failed. Please try again.' }, { status: 500 })
  }

  const { error: insertError } = await admin.from('otp_codes').insert({
    user_id:    userId,
    code:       null,
    code_hash:  codeHash,
    expires_at: expiresAt,
    used:       false,
  })
  if (insertError) {
    console.error(`[login] code insert failed (code ${insertError.code})`)
    return NextResponse.json({ error: 'Sign in failed. Please try again.' }, { status: 500 })
  }

  // Delivery is not wired up yet; recipients are resolved here and never revealed.
  await getOtpRecipients(userId)

  const devOtp = process.env.ALLOW_DEV_OTP === 'true' && process.env.NODE_ENV !== 'production'
  if (devOtp) console.log(`[DEV] login code: ${code}`)

  // Tokens are held encrypted in a short-lived cookie until the code is verified
  const cookieStore = await cookies()
  cookieStore.set(PENDING_SESSION_COOKIE, encrypt(JSON.stringify({
    access_token:  authData.session.access_token,
    refresh_token: authData.session.refresh_token,
    user_id:       userId,
  })), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     PENDING_SESSION_PATH,
    maxAge:   OTP_TTL_SECONDS,
  })

  return NextResponse.json({
    role:        profile.role,
    requiresOtp: true,
    ...(devOtp ? { devCode: code } : {}),
  })
}
