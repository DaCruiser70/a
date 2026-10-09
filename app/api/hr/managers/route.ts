import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'

const QuerySchema = z.strictObject({
  limit:  z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
})

// Active managers for the reporting-manager dropdown: id and name only
export async function GET(request: Request) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { limit, offset } = parsed.data

  const { data, error, count } = await createServiceClient()
    .from('managers')
    .select('id, full_name', { count: 'exact' })
    .eq('active', true)
    .order('full_name', { ascending: true })
    .range(offset, offset + limit - 1)

  if (error) {
    console.error(`[managers] list failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not load managers.' }, { status: 500 })
  }

  const total = count ?? 0
  return NextResponse.json({
    managers: (data ?? []).map(m => ({ id: m.id, name: m.full_name })),
    total,
    hasMore: offset + limit < total,
  })
}
