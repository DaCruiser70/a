import { createServiceClient } from '@/lib/supabase/server'
import { hmacHex } from '@/lib/auth-secrets'

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number }

// Counts one hit against a fixed window. Fails closed: any error counts as over the limit.
// The key must already be non-identifying; build it with rateLimitKey().
export async function rateLimit(key: string, max: number, windowSeconds: number): Promise<RateLimitResult> {
  // rate_limit_hit aligns windows to multiples of windowSeconds since the epoch
  const nowSeconds        = Math.floor(Date.now() / 1000)
  const retryAfterSeconds = Math.max(1, windowSeconds - (nowSeconds % windowSeconds))

  try {
    const { data, error } = await createServiceClient().rpc('rate_limit_hit', {
      p_key:            key,
      p_window_seconds: windowSeconds,
      p_max:            max,
    })
    if (error) {
      console.error(`rate_limit_hit failed (code ${error.code})`)
      return { allowed: false, retryAfterSeconds }
    }
    return { allowed: data === true, retryAfterSeconds }
  } catch {
    console.error('rate_limit_hit threw')
    return { allowed: false, retryAfterSeconds }
  }
}

// Keys are HMACs of the identifying value, never the raw IP or email
export async function rateLimitKey(scope: string, value: string): Promise<string> {
  return `${scope}:${await hmacHex('rate-limit', `${scope}:${value}`)}`
}

export function getClientIp(request: Request): string {
  const first = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first || 'local'
}
