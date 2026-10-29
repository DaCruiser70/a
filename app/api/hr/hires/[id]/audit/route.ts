import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { AUDIT_CATEGORIES, AUDIT_RULES, categorizeAudit } from '@/lib/audit-categories'

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

const QuerySchema = z.strictObject({
  offset:   z.coerce.number().int().min(0).max(100_000).default(0),
  limit:    z.coerce.number().int().min(1).max(100).default(25),
  category: z.enum(AUDIT_CATEGORIES).default('all'),
})

// HR hire page, Notes & Activity: the hire's audit log, newest first, 25 at a time (max 100),
// optionally filtered by category. Read-only and HR only. Messages were escaped when written.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { offset, limit, category } = parsed.data

  const admin = createServiceClient()
  const { data: hire } = await admin.from('profiles').select('id').eq('id', id).maybeSingle()
  if (!hire) return NOT_FOUND()

  let query = admin
    .from('audit_log')
    .select('id, action_type, message, created_at')
    .eq('user_id', id)

  // First matching rule wins: match this category's patterns and none of the earlier rules'
  if (category !== 'all') {
    const index = category === 'other' ? AUDIT_RULES.length : AUDIT_RULES.findIndex(r => r.category === category)
    for (const earlier of AUDIT_RULES.slice(0, index)) {
      for (const p of earlier.patterns) query = query.not('message', 'ilike', `%${p}%`)
    }
    if (category !== 'other') {
      // Values are quoted so the leading and trailing spaces in patterns like ' viewed ' are kept
      query = query.or(AUDIT_RULES[index].patterns.map(p => `message.ilike."*${p}*"`).join(','))
    }
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit)          // one extra row tells us whether there is more
  if (error) {
    console.error(`[hr/audit] list failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not load the activity. Please try again.' }, { status: 500 })
  }

  const rows = data ?? []
  const entries = rows.slice(0, limit).map(r => ({ ...r, category: categorizeAudit(r.message) }))
  return NextResponse.json(
    { entries, hasMore: rows.length > limit, nextOffset: offset + entries.length },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
