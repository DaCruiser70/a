import { NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encrypt'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import { PENDING_SESSION_COOKIE } from '@/lib/otp-session'
import { issueLoginCode, setPendingSession, devOtpEnabled } from '@/lib/otp-issue'
import { loadAccountMember } from '@/lib/pm-server'

// Step 2 of signing in to a shared regional project-management account: the person picks their
// name from the region's team and the code is sent to that member's own email.

const BodySchema = z.strictObject({ memberId: z.uuid() })

const PendingSchema = z.strictObject({
  access_token:    z.string().min(1).max(8192),
  refresh_token:   z.string().min(1).max(1024),
  user_id:         z.uuid(),
  member_id:       z.uuid().optional(),
  awaiting_member: z.boolean().optional(),
})

const WINDOW_SECONDS = 15 * 60

// Wrong region, unknown or inactive member, empty team: one generic answer for all of them
const UNAVAILABLE = () =>
  NextResponse.json({ error: 'Sign-in could not be completed. Please contact HR.' }, { status: 401 })
const SESSION_EXPIRED = () =>
  NextResponse.json({ error: 'Session expired. Please sign in again.' }, { status: 401 })

export async function POST(request: Request) {
  const ipLimit = await rateLimit(await rateLimitKey('login-member:ip', getClientIp(request)), 20, WINDOW_SECONDS)
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(ipLimit.retryAfterSeconds) } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { memberId } = parsed.data

  const cookieStore = await cookies()
  const pendingRaw  = cookieStore.get(PENDING_SESSION_COOKIE)?.value
  if (!pendingRaw) return SESSION_EXPIRED()

  let pending: z.infer<typeof PendingSchema>
  try {
    pending = PendingSchema.parse(JSON.parse(decrypt(pendingRaw)))
  } catch {
    return SESSION_EXPIRED()
  }
  // Only a shared account that has passed the password step (or is resending to its member)
  if (!pending.awaiting_member && !pending.member_id) return SESSION_EXPIRED()

  const accountLimit = await rateLimit(await rateLimitKey('login-member:account', pending.user_id), 10, WINDOW_SECONDS)
  if (!accountLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many sign-in attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(accountLimit.retryAfterSeconds) } },
    )
  }

  // The member must be active and in this account's own region; the browser's choice is only an id
  const admin  = createServiceClient()
  const member = await loadAccountMember(admin, pending.user_id, memberId)
  if (!member) return UNAVAILABLE()

  const issued = await issueLoginCode(admin, pending.user_id, member.id)
  if (!issued.ok) return UNAVAILABLE()

  await setPendingSession({
    access_token:  pending.access_token,
    refresh_token: pending.refresh_token,
    user_id:       pending.user_id,
    member_id:     member.id,
  })

  return NextResponse.json({
    requiresOtp: true,
    ...(devOtpEnabled() ? { devCode: issued.code } : {}),
  })
}
