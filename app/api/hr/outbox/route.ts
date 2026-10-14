import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { NOTIFICATION_TEMPLATES } from '@/lib/notify'

const QuerySchema = z.strictObject({
  status:   z.enum(['pending', 'sent', 'failed']).optional(),
  template: z.enum(NOTIFICATION_TEMPLATES).optional(),
  limit:    z.coerce.number().int().min(1).max(100).default(25),
  offset:   z.coerce.number().int().min(0).max(100_000).default(0),
})

// Read-only view of queued notifications, newest first
export async function GET(request: Request) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { status, template, limit, offset } = parsed.data

  let query = createServiceClient()
    .from('notification_outbox')
    .select('id, template, to_emails, payload, status, attempts, created_at, sent_at', { count: 'exact' })
    .order('created_at', { ascending: false })
  if (status)   query = query.eq('status', status)
  if (template) query = query.eq('template', template)

  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) {
    console.error(`[outbox] list failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not load notifications.' }, { status: 500 })
  }

  const total = count ?? 0
  return NextResponse.json({
    items: (data ?? []).map(row => ({
      id:         row.id,
      template:   row.template,
      hire_name:  typeof row.payload?.hireName === 'string' ? row.payload.hireName : null,
      recipients: row.to_emails ?? [],
      status:     row.status,
      attempts:   row.attempts,
      created_at: row.created_at,
      sent_at:    row.sent_at,
    })),
    total,
    hasMore: offset + limit < total,
  })
}
