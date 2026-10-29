import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { needsPmRequest, pmChipState } from '@/lib/pm'
import { memberNames } from '@/lib/pm-server'

// HR only: the hire's regional project-management state for the HR hire page.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = createServiceClient()
  const [{ data: hire }, { data: plan }, { data: req }] = await Promise.all([
    admin.from('profiles').select('id, region').eq('id', id).maybeSingle(),
    admin.from('manager_plans').select('status, clearance_type').eq('newhire_id', id).maybeSingle(),
    admin.from('pm_requests').select('status, region, claimed_by, claimed_at, completed_by, completed_at').eq('newhire_id', id).maybeSingle(),
  ])
  if (!hire) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const state = pmChipState(needsPmRequest(plan), req, hire.region)
  if (!state) return NextResponse.json({ needed: false })

  const names = await memberNames(admin, [req?.claimed_by, req?.completed_by])
  return NextResponse.json({
    needed:            true,
    state,
    region:            req?.region ?? null,
    claimed_by_name:   req?.claimed_by ? names[req.claimed_by] ?? null : null,
    claimed_at:        req?.claimed_at ?? null,
    completed_by_name: req?.completed_by ? names[req.completed_by] ?? null : null,
    completed_at:      req?.completed_at ?? null,
  })
}
