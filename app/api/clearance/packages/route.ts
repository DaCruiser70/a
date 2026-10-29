import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { getClearanceRequirements, PACKAGE_STAGES, type PackageStage } from '@/lib/clearance'

const QuerySchema = z.strictObject({
  stage:  z.enum(PACKAGE_STAGES).default('needs_review'),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  limit:  z.coerce.number().int().min(1).max(100).default(25),
})

export type PackageListRow = {
  hire_id: string; name: string; role: string | null; office: string | null; region: string | null
  project_name: string | null; sent_at: string | null; stage: PackageStage
}

// The clearance reviewer's list: only hires whose clearance is PSPC & RCMP and whose package has
// been sent. Name, role, office/region, project name and date sent; nothing else about the hire.
export async function GET(request: Request) {
  const auth = await requireRole('clearance')
  if (auth instanceof NextResponse) return auth

  const limit = await rateLimit(await rateLimitKey('clearance:list', auth.user.id), 240, 10 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { stage, offset, limit: size } = parsed.data

  const admin = createServiceClient()
  const { data: sent, error } = await admin
    .from('clearance_tracking')
    .select('newhire_id, package_stage, package_sent_at')
    .not('package_stage', 'is', null)
  if (error) {
    console.error(`[clearance/list] failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not load the packages. Please try again.' }, { status: 500 })
  }

  // Visibility: PSPC & RCMP on the submitted manager plan
  const ids = (sent ?? []).map(t => t.newhire_id)
  const { data: plans } = ids.length
    ? await admin.from('manager_plans').select('newhire_id, status, clearance_type').in('newhire_id', ids)
    : { data: [] }
  const pspc = new Set((plans ?? []).filter(p => getClearanceRequirements(p).type === 'pspc_rcmp').map(p => p.newhire_id))
  const visible = (sent ?? []).filter(t => pspc.has(t.newhire_id) && t.package_stage)

  const counts = Object.fromEntries(PACKAGE_STAGES.map(s => [s, visible.filter(t => t.package_stage === s).length])) as Record<PackageStage, number>
  const inStage = visible
    .filter(t => t.package_stage === stage)
    .sort((a, b) => (a.package_sent_at ?? '').localeCompare(b.package_sent_at ?? ''))
  const page = inStage.slice(offset, offset + size)

  const pageIds = page.map(t => t.newhire_id)
  const [{ data: profiles }, { data: pms }] = pageIds.length
    ? await Promise.all([
        admin.from('profiles').select('id, full_name, position, office_location, region').in('id', pageIds),
        admin.from('pm_requests').select('newhire_id, project_name').in('newhire_id', pageIds),
      ])
    : [{ data: [] }, { data: [] }]
  const profileMap = Object.fromEntries((profiles ?? []).map(p => [p.id, p]))
  const pmMap      = Object.fromEntries((pms ?? []).map(p => [p.newhire_id, p.project_name]))

  const rows: PackageListRow[] = page.map(t => ({
    hire_id:      t.newhire_id,
    name:         profileMap[t.newhire_id]?.full_name ?? '—',
    role:         profileMap[t.newhire_id]?.position ?? null,
    office:       profileMap[t.newhire_id]?.office_location ?? null,
    region:       profileMap[t.newhire_id]?.region ?? null,
    project_name: pmMap[t.newhire_id] ?? null,
    sent_at:      t.package_sent_at,
    stage:        t.package_stage!,
  }))

  return NextResponse.json(
    { rows, counts, total: inStage.length, hasMore: offset + size < inStage.length, nextOffset: offset + rows.length },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
