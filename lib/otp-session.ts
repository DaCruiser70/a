import { hmacHex, hmacVerifyHex } from './auth-secrets'

// Value formats:
//   v1.{userId}.{expiresAtEpochSeconds}.{signature}             — every account
//   v2.{userId}.{memberId}.{expiresAtEpochSeconds}.{signature}  — a shared regional project-management
//                                                                 account, bound to the team member who
//                                                                 received the sign-in code
// The signature is an HMAC-SHA256 in the 'otp-session' domain over "{userId}.{expiresAt}" (v1)
// or "{userId}.{memberId}.{expiresAt}" (v2).

export const OTP_SESSION_COOKIE  = 'otp_session'
export const OTP_SESSION_MAX_AGE = 28800 // 8 hours

// Encrypted tokens held between password sign-in and code verification
export const PENDING_SESSION_COOKIE = 'pending_session'
export const PENDING_SESSION_PATH   = '/api/auth'

const DOMAIN  = 'otp-session'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function signOtpSession(
  userId: string,
  options: { memberId?: string | null; maxAgeSeconds?: number } = {},
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + (options.maxAgeSeconds ?? OTP_SESSION_MAX_AGE)
  if (options.memberId) {
    const signature = await hmacHex(DOMAIN, `${userId}.${options.memberId}.${expiresAt}`)
    return `v2.${userId}.${options.memberId}.${expiresAt}.${signature}`
  }
  const signature = await hmacHex(DOMAIN, `${userId}.${expiresAt}`)
  return `v1.${userId}.${expiresAt}.${signature}`
}

export type OtpSession = { valid: false } | { valid: true; memberId: string | null }

// Checks format, expiry, user binding and signature (constant-time). Web Crypto only, so it also
// runs in the middleware's edge runtime.
export async function readOtpSession(value: string | undefined | null, userId: string): Promise<OtpSession> {
  if (!value || value.length > 260) return { valid: false }

  const parts = value.split('.')
  let sessionUserId: string, memberId: string | null, expiresAtRaw: string, signature: string, signed: string
  if (parts[0] === 'v1' && parts.length === 4) {
    ;[, sessionUserId, expiresAtRaw, signature] = parts
    memberId = null
    signed   = `${sessionUserId}.${expiresAtRaw}`
  } else if (parts[0] === 'v2' && parts.length === 5) {
    ;[, sessionUserId, memberId, expiresAtRaw, signature] = parts as [string, string, string, string, string]
    if (!UUID_RE.test(memberId)) return { valid: false }
    signed = `${sessionUserId}.${memberId}.${expiresAtRaw}`
  } else {
    return { valid: false }
  }

  if (!UUID_RE.test(sessionUserId) || sessionUserId !== userId) return { valid: false }
  if (!/^\d{1,12}$/.test(expiresAtRaw)) return { valid: false }
  if (Number(expiresAtRaw) <= Math.floor(Date.now() / 1000)) return { valid: false }
  if (!/^[0-9a-f]{64}$/.test(signature)) return { valid: false }

  try {
    const ok = await hmacVerifyHex(DOMAIN, signed, signature)
    return ok ? { valid: true, memberId } : { valid: false }
  } catch {
    // Missing or malformed secret: fail closed
    return { valid: false }
  }
}

export async function verifyOtpSession(value: string | undefined | null, userId: string): Promise<boolean> {
  return (await readOtpSession(value, userId)).valid
}
