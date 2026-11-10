import { NextResponse } from 'next/server'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import { cronAuthorized } from '@/lib/cron-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { reminderRunDue, runDailyReminders } from '@/lib/reminders'

// Queues the day's reminders (lib/reminders.ts); the dispatcher sends them. Scheduled at 13:00 and
// 14:00 UTC so one of them is 9 o'clock in Toronto in both summer and winter: any other hour, and
// weekends and holidays, return "not due" without doing anything. The Toronto date is part of every
// dedupe key, so a second call the same day queues nothing new.
// Not a user route, so no requireRole: the shared secret (lib/cron-auth.ts) is the whole gate. It
// takes no body and no parameters.
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }
const UNAUTHORIZED = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
const TOO_MANY     = (retry: number) => NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(retry), ...NO_STORE } })

export async function GET(request: Request) {
  const caller = await rateLimit(await rateLimitKey('cron:reminders-ip', getClientIp(request)), 20, 60)
  if (!caller.allowed) return TOO_MANY(caller.retryAfterSeconds)

  if (!cronAuthorized(request.headers.get('authorization'))) return UNAUTHORIZED()

  if (Number(request.headers.get('content-length') ?? 0) > 0 || new URL(request.url).search) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE })
  }

  const { due, date } = reminderRunDue(new Date())
  if (!due) return NextResponse.json({ ok: true, due: false, message: 'Not due' }, { headers: NO_STORE })

  const runs = await rateLimit('cron:reminders-run', 4, 60 * 60)
  if (!runs.allowed) return TOO_MANY(runs.retryAfterSeconds)

  try {
    const result = await runDailyReminders(createServiceClient(), { asOf: date, apply: true })
    if (result.paused) return NextResponse.json({ ok: true, due: true, paused: true, message: 'Reminders are paused: nothing queued' }, { headers: NO_STORE })
    // Counts only
    const { counts, emails, queued, duplicates, unreachable } = result
    console.log(`[reminders] ${date}: ${emails} emails planned, ${queued} queued, ${duplicates} already queued, ${unreachable} unreachable`)
    return NextResponse.json({ ok: true, due: true, date, counts, emails, queued, duplicates, unreachable }, { headers: NO_STORE })
  } catch {
    console.error('[reminders] run failed')
    return NextResponse.json({ error: 'The reminder run failed.' }, { status: 500, headers: NO_STORE })
  }
}
