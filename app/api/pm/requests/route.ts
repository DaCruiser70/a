import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { PM_TABS } from '@/lib/pm'
import { describePmRequests, pmMemberOr401 } from '@/lib/pm-server'

const QuerySchema = z.strictObject({
  tab:    z.enum(PM_TABS),
  limit:  z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
})

// The signed-in member's region only. The region comes from the session, never from the browser.
//   open → unclaimed requests · mine → claimed by this member · done → completed
export async function GET(request: Request) {
  const auth = await requireRole('project_mgmt')
  if (auth instanceof NextResponse) return auth
  const member = pmMemberOr401(auth.member)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const readLimit = await rateLimit(await rateLimitKey('pm:read', member.id), 300, 15 * 60)
  if (!readLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(readLimit.retryAfterSeconds) } },
    )
  }

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { tab, limit, offset } = parsed.data

  const admin = createServiceClient()
  let query = admin
    .from('pm_requests')
    .select('newhire_id, status, claimed_by, claimed_at, completed_at, region', { count: 'exact' })
    .eq('region', member.region)

  if (tab === 'open')      query = query.eq('status', 'open').order('created_at', { ascending: true })
  else if (tab === 'mine') query = query.eq('status', 'claimed').eq('claimed_by', member.id).order('claimed_at', { ascending: false })
  else                     query = query.eq('status', 'done').order('completed_at', { ascending: false })

  const { data, error, count } = await query.range(offset, offset + limit - 1)
  if (error) {
    console.error(`[pm/requests] list failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not load requests.' }, { status: 500 })
  }

  const total = count ?? 0
  return NextResponse.json({
    region:   member.region,
    requests: await describePmRequests(admin, data ?? []),
    total,
    hasMore:  offset + limit < total,
  })
}
