import { NextResponse } from 'next/server'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import { dispatchNotifications } from '@/lib/notify-dispatch'
import { cronAuthorized } from '@/lib/cron-auth'

// Runs one dispatcher batch. Called every minute by the scheduler (Vercel Cron sends
// "Authorization: Bearer <CRON_SECRET>" itself), or by hand with the same header.
// Not a user route, so no requireRole: the shared secret is the whole gate. It takes no body and no
// parameters, so it can only send what is already queued, to the recipients the dispatcher looks up.
export const dynamic = 'force-dynamic'

const UNAUTHORIZED = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
const TOO_MANY     = (retry: number) => NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(retry), 'Cache-Control': 'no-store' } })

export async function GET(request: Request) {
  // Per caller, before the secret check, so guessing is slow too
  const caller = await rateLimit(await rateLimitKey('cron:dispatch-ip', getClientIp(request)), 20, 60)
  if (!caller.allowed) return TOO_MANY(caller.retryAfterSeconds)

  if (!cronAuthorized(request.headers.get('authorization'))) return UNAUTHORIZED()

  // No body and no query: nothing a caller sends can steer a run
  if (Number(request.headers.get('content-length') ?? 0) > 0 || new URL(request.url).search) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }

  // At most a few runs a minute in total (the scheduler plus a manual call)
  const runs = await rateLimit('cron:dispatch-run', 4, 60)
  if (!runs.allowed) return TOO_MANY(runs.retryAfterSeconds)

  const s = await dispatchNotifications({ limit: 25 })
  // Counts only
  return NextResponse.json({
    ok: true, skipped: s.skipped, claimed: s.claimed, sent: s.sent, failed: s.failed,
    dead: s.dead, deferred: s.deferred, released: s.released,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
