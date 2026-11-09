import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { isRegion, needsPmRequest, pmChipState, pmRegionWarnings } from '@/lib/pm'
import { activeRegionMembers, memberNames } from '@/lib/pm-server'

// HR only: the hire's regional project-management state for the HR hire page.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = createServiceClient()
  const [{ data: hire }, { data: plan }, { data: req }] = await Promise.all([
    admin.from('profiles').select('id').eq('id', id).maybeSingle(),
    admin.from('manager_plans').select('status, clearance_type, project_region').eq('newhire_id', id).maybeSingle(),
    admin.from('pm_requests')
      .select('status, region, claimed_by, claimed_at, completed_by, completed_at, dcc, standing_offer, project_name, project_location')
      .eq('newhire_id', id).maybeSingle(),
  ])
  if (!hire) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const state = pmChipState(needsPmRequest(plan), req, plan?.project_region)
  if (!state) return NextResponse.json({ needed: false })

  const [names, team] = await Promise.all([
    memberNames(admin, [req?.claimed_by, req?.completed_by]),
    isRegion(req?.region) ? activeRegionMembers(admin, req.region) : Promise.resolve([]),
  ])
  return NextResponse.json({
    needed:            true,
    state,
    region:            req?.region ?? null,
    warnings:          pmRegionWarnings(req, plan?.project_region, team.length),
    claimed_by_name:   req?.claimed_by ? names[req.claimed_by] ?? null : null,
    claimed_at:        req?.claimed_at ?? null,
    completed_by_name: req?.completed_by ? names[req.completed_by] ?? null : null,
    completed_at:      req?.completed_at ?? null,
    // Project details from project management (HR and project_mgmt only)
    details: {
      dcc:              req?.dcc ?? null,
      standing_offer:   req?.standing_offer ?? null,
      project_name:     req?.project_name ?? null,
      project_location: req?.project_location ?? null,
    },
  })
}
