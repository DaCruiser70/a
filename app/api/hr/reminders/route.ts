import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { readReminderSettings, setRemindersPaused } from '@/lib/reminder-settings'

// HR's "Pause reminders" switch. While paused the daily run queues nothing; nothing is lost, and
// after resuming the normal rules catch up (still one email per person per day).
const BodySchema = z.strictObject({ paused: z.boolean() })
const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET() {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const s = await readReminderSettings(createServiceClient())
  if (!s) return NextResponse.json({ error: 'Could not load the reminder setting.' }, { status: 500, headers: NO_STORE })
  return NextResponse.json({ paused: s.paused, changed_at: s.changed_at }, { headers: NO_STORE })
}

export async function POST(request: Request) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:reminders-pause', user.id), 20, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many changes in a short time. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds), ...NO_STORE } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE })
  const { paused } = parsed.data

  const admin = createServiceClient()
  let changed: boolean
  try {
    changed = await setRemindersPaused(admin, paused, user.id)
  } catch {
    return NextResponse.json({ error: 'Could not change the setting. Please try again.' }, { status: 500, headers: NO_STORE })
  }

  if (changed) {
    // The HR user's own record; no personal content in the message
    await admin.from('audit_log').insert({
      user_id: user.id, performed_by: user.id, action_type: paused ? 'amber' : 'navy',
      message: `<strong>HR</strong> ${paused ? 'paused' : 'resumed'} daily reminders`,
    })
  }
  const s = await readReminderSettings(admin)
  return NextResponse.json({ ok: true, paused: s?.paused ?? paused, changed_at: s?.changed_at ?? null }, { headers: NO_STORE })
}
