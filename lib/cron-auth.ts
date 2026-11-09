import { createHash, timingSafeEqual } from 'node:crypto'

// Server only. The scheduler's shared secret (CRON_SECRET), sent as "Authorization: Bearer <secret>".
// Compared in constant time: both sides are hashed to the same length first. A missing or short
// secret refuses every call. Never logged.
const MIN_SECRET_LENGTH = 32

export function cronAuthorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || secret.length < MIN_SECRET_LENGTH || !header) return false
  const given    = createHash('sha256').update(header, 'utf8').digest()
  const expected = createHash('sha256').update(`Bearer ${secret}`, 'utf8').digest()
  return timingSafeEqual(given, expected)
}
