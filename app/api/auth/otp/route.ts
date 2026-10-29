import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient, createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { decrypt } from '@/lib/encrypt'
import { hmacHex } from '@/lib/auth-secrets'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import {
  signOtpSession, OTP_SESSION_COOKIE, OTP_SESSION_MAX_AGE,
  PENDING_SESSION_COOKIE, PENDING_SESSION_PATH,
} from '@/lib/otp-session'
import { landingHref, parseRoles } from '@/lib/portals'
import { otpCodeHashInput } from '@/lib/otp-issue'

const BodySchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/),
})

const PendingSchema = z.strictObject({
  access_token:    z.string().min(1).max(8192),
  refresh_token:   z.string().min(1).max(1024),
  user_id:         z.uuid(),
  member_id:       z.uuid().optional(),     // shared project-management account
  awaiting_member: z.boolean().optional(),  // no member chosen yet, so no code exists
})

const SESSION_EXPIRED = 'Session expired. Please sign in again.'

export async function POST(request: Request) {
  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Please enter the full 6-digit code.' }, { status: 400 })
  const { code } = parsed.data

  const limit = await rateLimit(await rateLimitKey('otp:ip', getClientIp(request)), 30, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const cookieStore = await cookies()
  const clearPending = () => cookieStore.set(PENDING_SESSION_COOKIE, '', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     PENDING_SESSION_PATH,
    maxAge:   0,
  })

  const pendingRaw = cookieStore.get(PENDING_SESSION_COOKIE)?.value
  if (!pendingRaw) return NextResponse.json({ error: SESSION_EXPIRED }, { status: 401 })

  let pending: z.infer<typeof PendingSchema>
  try {
    pending = PendingSchema.parse(JSON.parse(decrypt(pendingRaw)))
  } catch {
    clearPending()
    return NextResponse.json({ error: SESSION_EXPIRED }, { status: 401 })
  }

  // A shared account must have picked a member before any code can be checked
  if (pending.awaiting_member) return NextResponse.json({ error: SESSION_EXPIRED }, { status: 401 })

  const codeHash = await hmacHex('otp-code', otpCodeHashInput(pending.user_id, code, pending.member_id))

  const { data: result, error: otpError } = await createServiceClient()
    .rpc('verify_otp', { p_user_id: pending.user_id, p_code_hash: codeHash })

  if (otpError) {
    console.error(`[otp] verify_otp failed (code ${otpError.code})`)
    return NextResponse.json({ error: 'Verification failed. Please try again.' }, { status: 500 })
  }

  if (result === 'bad') {
    return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 })
  }

  if (result !== 'ok') {
    // 'locked' or 'none'
    clearPending()
    return NextResponse.json({ error: 'Code expired or locked. Please sign in again.' }, { status: 400 })
  }

  // Write the Supabase session into cookies server-side so the middleware sees
  // it immediately on the next request — no client-side setSession needed.
  const ssrClient = await createClient()
  const { data: sessionData, error: sessionError } = await ssrClient.auth.setSession({
    access_token:  pending.access_token,
    refresh_token: pending.refresh_token,
  })
  if (sessionError || !sessionData.user || sessionData.user.id !== pending.user_id) {
    clearPending()
    return NextResponse.json({ error: SESSION_EXPIRED }, { status: 401 })
  }

  // Landing portal from server-controlled app_metadata
  const appMeta = sessionData.user.app_metadata ?? {}
  const landing = landingHref(appMeta.role, parseRoles(appMeta.roles))

  clearPending()

  // For a shared account the session records (and signs) which team member signed in
  cookieStore.set(OTP_SESSION_COOKIE, await signOtpSession(pending.user_id, { memberId: pending.member_id }), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   OTP_SESSION_MAX_AGE,
  })

  return NextResponse.json({ ok: true, landing })
}
