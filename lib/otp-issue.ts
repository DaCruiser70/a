import { randomInt } from 'node:crypto'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'
import { encrypt } from '@/lib/encrypt'
import { hmacHex } from '@/lib/auth-secrets'
import { getOtpRecipients } from '@/lib/otp-recipients'
import { PENDING_SESSION_COOKIE, PENDING_SESSION_PATH } from '@/lib/otp-session'

// Shared by the password step and the team-member step of sign-in. Server only.

export const OTP_TTL_SECONDS = 300

// What the pending_session cookie holds between steps (encrypted with lib/encrypt.ts)
export type PendingSession = {
  access_token:    string
  refresh_token:   string
  user_id:         string
  member_id?:      string      // shared project-management account: the member the code went to
  awaiting_member?: boolean    // shared account: password accepted, no member chosen yet
}

// The stored hash binds the code to the account and, for a shared account, to the member
export function otpCodeHashInput(userId: string, code: string, memberId?: string | null): string {
  return memberId ? `${userId}:${memberId}:${code}` : `${userId}:${code}`
}

export async function setPendingSession(value: PendingSession): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(PENDING_SESSION_COOKIE, encrypt(JSON.stringify(value)), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     PENDING_SESSION_PATH,
    maxAge:   OTP_TTL_SECONDS,
  })
}

// Issues a fresh 6-digit code: clears stale codes, invalidates unused ones, stores only the HMAC,
// resolves the recipients (sending is not wired up yet). Returns the code for the dev-only echo.
export async function issueLoginCode(
  admin: SupabaseClient<Database>,
  userId: string,
  memberId: string | null,
): Promise<{ ok: true; code: string } | { ok: false }> {
  const code      = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const codeHash  = await hmacHex('otp-code', otpCodeHashInput(userId, code, memberId))
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
    return { ok: false }
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
    return { ok: false }
  }

  // Delivery is not wired up yet; recipients are resolved here and never revealed.
  const recipients = await getOtpRecipients(userId, memberId)
  if (memberId && recipients.length === 0) return { ok: false }

  if (process.env.ALLOW_DEV_OTP === 'true' && process.env.NODE_ENV !== 'production') {
    console.log(`[DEV] login code: ${code}`)
  }
  return { ok: true, code }
}

export function devOtpEnabled(): boolean {
  return process.env.ALLOW_DEV_OTP === 'true' && process.env.NODE_ENV !== 'production'
}
