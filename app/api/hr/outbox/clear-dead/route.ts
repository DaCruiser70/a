import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { clearDeadAuditMessage, clearDeadNotifications } from '@/lib/notify-retention'

// HR's "Clear dead notifications": deletes every row with status 'dead' and nothing else. Their
// dedupe keys stay in notification_keys, so none of those events can be queued again by accident.
const BodySchema = z.strictObject({ confirm: z.literal(true) })
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(request: Request) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:outbox-clear-dead', user.id), 10, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds), ...NO_STORE } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  if (!BodySchema.safeParse(raw).success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE })

  const admin = createServiceClient()
  let cleared: number
  try {
    cleared = await clearDeadNotifications(admin, { apply: true })
  } catch {
    console.error('[outbox] clear dead failed')
    return NextResponse.json({ error: 'Could not clear them. Please try again.' }, { status: 500, headers: NO_STORE })
  }

  if (cleared > 0) {
    // On the HR user's own record: the count only
    await admin.from('audit_log').insert({
      user_id: user.id, performed_by: user.id, action_type: 'amber',
      message: clearDeadAuditMessage(cleared),
    })
  }
  return NextResponse.json({ ok: true, cleared }, { headers: NO_STORE })
}
