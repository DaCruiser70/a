import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { mailConfig } from '@/lib/mailer'
import { NOTIFICATION_TEMPLATES } from '@/lib/notify'
import { AUDIENCE_LABELS, type Audience } from '@/lib/notification-templates'

const STATUSES = ['queued', 'sending', 'sent', 'failed', 'dead'] as const

const QuerySchema = z.strictObject({
  status:   z.enum(STATUSES).optional(),
  template: z.enum(NOTIFICATION_TEMPLATES).optional(),
  limit:    z.coerce.number().int().min(1).max(100).default(25),
  offset:   z.coerce.number().int().min(0).max(100_000).default(0),
})

// Queued notifications, newest first. Recipients are shown as roles, never addresses (the outbox
// holds none). The error is a short code only.
export async function GET(request: Request) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { status, template, limit, offset } = parsed.data

  const admin = createServiceClient()
  let query = admin
    .from('notification_outbox')
    .select('id, template, newhire_id, audience, status, attempts, last_error, created_at, sent_at', { count: 'exact' })
    .order('created_at', { ascending: false })
  if (status)   query = query.eq('status', status)
  if (template) query = query.eq('template', template)

  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) {
    console.error(`[outbox] list failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not load notifications.' }, { status: 500 })
  }

  const hireIds = [...new Set((data ?? []).map(r => r.newhire_id).filter((v): v is string => !!v))]
  const { data: hires } = hireIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', hireIds)
    : { data: [] as { id: string; full_name: string }[] }
  const nameOf = new Map((hires ?? []).map(h => [h.id, h.full_name]))

  const config = mailConfig()
  const total  = count ?? 0
  return NextResponse.json({
    mode: config.ready ? config.mode : 'off',
    items: (data ?? []).map(row => ({
      id:         row.id,
      template:   row.template,
      hire_name:  (row.newhire_id && nameOf.get(row.newhire_id)) || null,
      audience:   (row.audience ?? []).map(a => AUDIENCE_LABELS[a as Audience]).filter(Boolean),
      status:     row.status,
      attempts:   row.attempts,
      error_code: row.status === 'failed' || row.status === 'dead' ? row.last_error : null,
      created_at: row.created_at,
      sent_at:    row.sent_at,
    })),
    total,
    hasMore: offset + limit < total,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
