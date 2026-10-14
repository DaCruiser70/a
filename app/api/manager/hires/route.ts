import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { computeHireStatus } from '@/lib/hire-status'
import { managerIdsFor } from '@/lib/manager-access'
import { isPlanOverdue, todayIso } from '@/lib/manager-plan'

const QuerySchema = z.strictObject({
  section: z.enum(['action', 'submitted']),
  limit:   z.coerce.number().int().min(1).max(100).default(25),
  offset:  z.coerce.number().int().min(0).max(10_000).default(0),
})

// The signed-in manager's hires, one section at a time.
// Only the hire's name, role, start date, office and onboarding progress — nothing personal or sensitive.
export async function GET(request: Request) {
  const auth = await requireRole('manager')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { section, limit, offset } = parsed.data

  const admin = createServiceClient()
  const managerIds = await managerIdsFor(admin, user.id)
  if (managerIds.length === 0) return NextResponse.json({ hires: [], total: 0, hasMore: false })

  let query = admin
    .from('manager_plans')
    .select('newhire_id, status, due_date, submitted_at', { count: 'exact' })
    .in('manager_id', managerIds)

  query = section === 'action'
    ? query.in('status', ['requested', 'draft']).order('due_date', { ascending: true, nullsFirst: false })
    : query.eq('status', 'submitted').order('submitted_at', { ascending: false })

  const { data: plans, error, count } = await query.range(offset, offset + limit - 1)
  if (error) {
    console.error(`[manager/hires] list failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not load your new hires.' }, { status: 500 })
  }

  const hireIds = (plans ?? []).map(p => p.newhire_id)
  const total   = count ?? 0
  if (hireIds.length === 0) return NextResponse.json({ hires: [], total, hasMore: false })

  const [profiles, pi, bi, si, po] = await Promise.all([
    admin.from('profiles').select('id, full_name, position, start_date, office_location').in('id', hireIds),
    admin.from('personal_info').select('user_id, form_status').in('user_id', hireIds),
    admin.from('banking_info').select('user_id, form_status').in('user_id', hireIds),
    admin.from('sin_info').select('user_id, form_status').in('user_id', hireIds),
    admin.from('policy_acknowledgements').select('user_id, form_status').in('user_id', hireIds),
  ])

  const byId = <T extends { user_id: string }>(rows: T[] | null) =>
    Object.fromEntries((rows ?? []).map(r => [r.user_id, r]))
  const profileMap = Object.fromEntries((profiles.data ?? []).map(p => [p.id, p]))
  const piMap = byId(pi.data), biMap = byId(bi.data), siMap = byId(si.data), poMap = byId(po.data)
  const today = todayIso()

  const hires = (plans ?? []).map(plan => {
    const p = profileMap[plan.newhire_id]
    const computed = computeHireStatus([
      piMap[plan.newhire_id]?.form_status, biMap[plan.newhire_id]?.form_status,
      siMap[plan.newhire_id]?.form_status, poMap[plan.newhire_id]?.form_status,
    ])
    return {
      hire_id:         plan.newhire_id,
      name:            p?.full_name       ?? '—',
      position:        p?.position        ?? null,
      start_date:      p?.start_date      ?? null,
      office_location: p?.office_location ?? null,
      progress:        computed.progressPct,
      hire_status:     computed.status,
      plan_status:     plan.status,
      due_date:        plan.due_date,
      submitted_at:    plan.submitted_at,
      overdue:         isPlanOverdue(plan.status, plan.due_date, today),
    }
  })

  return NextResponse.json({ hires, total, hasMore: offset + limit < total })
}
