import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { esc } from '@/lib/safe-html'
import { kickDispatcher, dueNow } from '@/lib/notify'
import { TEMPLATE_LABELS, isNotificationTemplate } from '@/lib/notification-templates'

// HR's two actions on one queued notification. Neither can change who it goes to or what it says:
// the row is only put back in line, and the dispatcher builds recipients and content as always.
//   retry     failed or dead → queued, attempts reset, due now
//   send_now  queued or failed → due now
// Each is one conditional UPDATE, then a best-effort send of that row.
const BodySchema = z.strictObject({ action: z.enum(['retry', 'send_now']) })

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:outbox-action', user.id), 30, 10 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { action } = parsed.data

  const admin = createServiceClient()
  const now   = new Date().toISOString()
  const { data: rows, error } = action === 'retry'
    ? await admin.from('notification_outbox')
        .update({ status: 'queued', attempts: 0, send_after: dueNow(), claimed_at: null, updated_at: now })
        .eq('id', id).in('status', ['failed', 'dead'])
        .select('id, template, newhire_id')
    : await admin.from('notification_outbox')
        .update({ send_after: dueNow(), updated_at: now })
        .eq('id', id).in('status', ['queued', 'failed'])
        .select('id, template, newhire_id')
  if (error) {
    console.error(`[outbox] ${action} failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not update the notification. Please try again.' }, { status: 500 })
  }
  // Missing, or no longer in a state this action applies to: the same answer either way
  const row = rows?.[0]
  if (!row) return NOT_FOUND()

  const label = isNotificationTemplate(row.template) ? TEMPLATE_LABELS[row.template] : 'notification'
  await admin.from('audit_log').insert({
    user_id:      row.newhire_id ?? user.id,
    action_type:  'navy',
    message:      `<strong>HR</strong> ${action === 'retry' ? 'retried' : 'asked to send now'} the “${esc(label)}” notification`,
    performed_by: user.id,
  })

  kickDispatcher([row.id])
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
