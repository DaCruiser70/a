import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { describePmRequests, memberNames, pmMemberOr401 } from '@/lib/pm-server'

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

// One request in the member's region: hire name, region, branch, start date, manager and the
// project block from the manager plan. A request in another region, a cancelled one and an
// unknown id all give the same 404. No clearance, payroll, banking, SIN or document data is read.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  const admin = createServiceClient()
  const { data: req } = await admin
    .from('pm_requests')
    .select('newhire_id, status, claimed_by, claimed_at, completed_by, completed_at, region')
    .eq('newhire_id', id)
    .eq('region', member.region)
    .neq('status', 'cancelled')
    .maybeSingle()
  if (!req) return NOT_FOUND()

  // Column names from lib/manager-plan.ts (PROJECT_TEXT_FIELDS plus project_region / project_branch)
  const [[card], { data: plan }, completers] = await Promise.all([
    describePmRequests(admin, [req]),
    admin.from('manager_plans')
      .select('project_number, project_name, project_region, project_location, project_branch')
      .eq('newhire_id', id).maybeSingle(),
    memberNames(admin, [req.completed_by]),
  ])

  return NextResponse.json({
    request: {
      ...card,
      completed_by_name: req.completed_by ? completers[req.completed_by] ?? null : null,
      mine:              req.claimed_by === member.id,
    },
    project: {
      number:   plan?.project_number   ?? null,
      name:     plan?.project_name     ?? null,
      region:   plan?.project_region   ?? null,
      location: plan?.project_location ?? null,
      branch:   plan?.project_branch   ?? null,
    },
    me: { id: member.id, name: member.member_name },
  })
}
