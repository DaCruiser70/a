import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { answersFromRow, isPlanOverdue, todayIso } from '@/lib/manager-plan'

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

// The hire's manager plan for the HR detail page. plan is null for hires that predate manager plans.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  const admin = createServiceClient()
  const [{ data: hire }, { data: plan }] = await Promise.all([
    admin.from('profiles').select('id, reporting_manager_id').eq('id', id).maybeSingle(),
    admin.from('manager_plans').select('*').eq('newhire_id', id).maybeSingle(),
  ])
  if (!hire) return NOT_FOUND()

  const managerId = plan?.manager_id ?? hire.reporting_manager_id
  const { data: manager } = managerId
    ? await admin.from('managers').select('id, full_name').eq('id', managerId).maybeSingle()
    : { data: null }

  return NextResponse.json({
    manager: manager ? { id: manager.id, name: manager.full_name } : null,
    plan: plan ? {
      status:       plan.status,
      due_date:     plan.due_date,
      submitted_at: plan.submitted_at,
      overdue:      isPlanOverdue(plan.status, plan.due_date, todayIso()),
      // Answers are shown to HR once the manager submits; drafts stay with the manager
      answers:      plan.status === 'submitted' ? answersFromRow(plan) : null,
    } : null,
  })
}
