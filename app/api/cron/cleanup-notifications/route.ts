import { NextResponse } from 'next/server'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import { cronAuthorized } from '@/lib/cron-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { auditCleanupRun, purgeOldNotifications } from '@/lib/notify-retention'

// Daily outbox cleanup (lib/notify-retention.ts): sent and dead rows past their retention, in small
// batches. Queued, sending and failed rows are never touched, and audit_log is never cleaned.
// Not a user route, so no requireRole: the shared secret (lib/cron-auth.ts) is the whole gate. It
// takes no body and no parameters.
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UNAUTHORIZED = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
const TOO_MANY     = (retry: number) => NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(retry), ...NO_STORE } })

export async function GET(request: Request) {
  const caller = await rateLimit(await rateLimitKey('cron:cleanup-ip', getClientIp(request)), 20, 60)
  if (!caller.allowed) return TOO_MANY(caller.retryAfterSeconds)

  if (!cronAuthorized(request.headers.get('authorization'))) return UNAUTHORIZED()

  if (Number(request.headers.get('content-length') ?? 0) > 0 || new URL(request.url).search) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE })
  }

  const runs = await rateLimit('cron:cleanup-run', 4, 60 * 60)
  if (!runs.allowed) return TOO_MANY(runs.retryAfterSeconds)

  try {
    const admin = createServiceClient()
    const removed = await purgeOldNotifications(admin, { apply: true })
    const audited = await auditCleanupRun(admin, removed)
    console.log(`[cleanup] removed ${removed.sent} sent, ${removed.dead} dead`)
    return NextResponse.json({ ok: true, removed, audited }, { headers: NO_STORE })
  } catch {
    console.error('[cleanup] run failed')
    return NextResponse.json({ error: 'The cleanup failed.' }, { status: 500, headers: NO_STORE })
  }
}
