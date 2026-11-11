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

// Reads a key's hits in the current window without counting one (same window alignment as
// rate_limit_hit). Fails closed: any error reads as over the limit.
export async function rateLimitPeek(key: string, max: number, windowSeconds: number): Promise<RateLimitResult> {
  const nowSeconds        = Math.floor(Date.now() / 1000)
  const retryAfterSeconds = Math.max(1, windowSeconds - (nowSeconds % windowSeconds))
  const windowStart       = new Date((nowSeconds - (nowSeconds % windowSeconds)) * 1000).toISOString()
  try {
    // rate_limits is not in the generated Database type (service role only, written by rate_limit_hit)
    const admin = createServiceClient() as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: { hits: number } | null; error: { code?: string } | null }> } } } } }
    const { data, error } = await admin.from('rate_limits').select('hits').eq('key', key).eq('window_start', windowStart).maybeSingle()
    if (error) {
      console.error(`rate limit read failed (code ${error.code ?? 'unknown'})`)
      return { allowed: false, retryAfterSeconds }
    }
    return { allowed: (data?.hits ?? 0) < max, retryAfterSeconds }
  } catch {
    console.error('rate limit read threw')
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
