import { hmacHex, hmacVerifyHex } from './auth-secrets'

// Value format: v1.{userId}.{expiresAtEpochSeconds}.{signature}
// The signature is an HMAC-SHA256 over "{userId}.{expiresAt}" in the 'otp-session' domain.

export const OTP_SESSION_COOKIE  = 'otp_session'
export const OTP_SESSION_MAX_AGE = 28800 // 8 hours

// Encrypted tokens held between password sign-in and code verification
export const PENDING_SESSION_COOKIE = 'pending_session'
export const PENDING_SESSION_PATH   = '/api/auth'

const DOMAIN  = 'otp-session'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function signOtpSession(userId: string, maxAgeSeconds = OTP_SESSION_MAX_AGE): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + maxAgeSeconds
  const signature = await hmacHex(DOMAIN, `${userId}.${expiresAt}`)
  return `v1.${userId}.${expiresAt}.${signature}`
}

export async function verifyOtpSession(value: string | undefined | null, userId: string): Promise<boolean> {
  if (!value || value.length > 200) return false

  const parts = value.split('.')
  if (parts.length !== 4) return false
  const [version, sessionUserId, expiresAtRaw, signature] = parts

  if (version !== 'v1') return false
  if (!UUID_RE.test(sessionUserId) || sessionUserId !== userId) return false
  if (!/^\d{1,12}$/.test(expiresAtRaw)) return false
  if (Number(expiresAtRaw) <= Math.floor(Date.now() / 1000)) return false
  if (!/^[0-9a-f]{64}$/.test(signature)) return false

  try {
    return await hmacVerifyHex(DOMAIN, `${sessionUserId}.${expiresAtRaw}`, signature)
  } catch {
    // Missing or malformed secret: fail closed
    return false
  }
}
