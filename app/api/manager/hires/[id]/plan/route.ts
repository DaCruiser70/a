import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { ownedPlan } from '@/lib/manager-access'
import { queueNotification, hrNotifyEmails, appUrl } from '@/lib/notify'
import {
  PlanPutSchema, answersFromRow, fieldErrors, isPlanOverdue, todayIso,
  PLAN_TEXT_FIELDS, PROJECT_TEXT_FIELDS,
} from '@/lib/manager-plan'
import type { Database } from '@/types'

type PlanUpdate = Database['public']['Tables']['manager_plans']['Update']

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('manager')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  const admin = createServiceClient()
  const plan = await ownedPlan(admin, user.id, id)
  if (!plan) return NOT_FOUND()

  const { data: hire } = await admin
    .from('profiles')
    .select('id, full_name, position, start_date, office_location')
    .eq('id', id)
    .maybeSingle()
  if (!hire) return NOT_FOUND()

  return NextResponse.json({
    hire: {
      id:              hire.id,
      name:            hire.full_name,
      position:        hire.position,
      start_date:      hire.start_date,
      office_location: hire.office_location,
    },
    plan: {
      status:       plan.status,
      due_date:     plan.due_date,
      submitted_at: plan.submitted_at,
      overdue:      isPlanOverdue(plan.status, plan.due_date, todayIso()),
      answers:      answersFromRow(plan),
    },
  })
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('manager')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('manager:plan-save', user.id), 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many saves in a short time. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = PlanPutSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Some answers need attention before this can be saved.', fields: fieldErrors(parsed.error) },
      { status: 400 },
    )
  }
  const { action, plan: answers } = parsed.data

  const { id } = await params
  const admin = createServiceClient()
  const existing = await ownedPlan(admin, user.id, id)
  if (!existing) return NOT_FOUND()

  // Once submitted, a plan is only ever updated as a full submission
  if (action === 'draft' && existing.status === 'submitted') {
    return NextResponse.json({ error: 'This plan has already been submitted. Use Save changes instead.' }, { status: 409 })
  }

  const update: PlanUpdate = {
    status:            action === 'submit' ? 'submitted' : 'draft',
    training_delivery: answers.training_delivery,
    clearance_type:    answers.clearance_type,
    updated_at:        new Date().toISOString(),
  }
  for (const field of PLAN_TEXT_FIELDS) update[field] = answers[field] || null

  // Project details are written only under PSPC & RCMP. Switching to another clearance type
  // leaves whatever was stored before untouched; nothing is deleted.
  if (answers.clearance_type === 'pspc_rcmp') {
    for (const field of PROJECT_TEXT_FIELDS) update[field] = answers[field] || null
    update.project_region = answers.project_region || null
    update.project_branch = answers.project_branch || null
  }

  // manager_id in the filter: if HR reassigned the hire mid-request, nothing is written
  const { data: saved, error } = await admin
    .from('manager_plans')
    .update(update)
    .eq('newhire_id', id)
    .eq('manager_id', existing.manager_id)
    .select('status, submitted_at')
  if (error) {
    console.error(`[manager/plan] update failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save the plan. Please try again.' }, { status: 500 })
  }
  if (!saved || saved.length === 0) return NOT_FOUND()

  let submittedAt = saved[0].submitted_at
  let firstSubmit = false
  if (action === 'submit') {
    // Only the first submission sets submitted_at; the condition makes this race-safe
    const { data: stamped } = await admin
      .from('manager_plans')
      .update({ submitted_at: new Date().toISOString() })
      .eq('newhire_id', id)
      .is('submitted_at', null)
      .select('submitted_at')
    if (stamped && stamped.length > 0) {
      firstSubmit = true
      submittedAt = stamped[0].submitted_at
    }
  }

  const audit =
    action === 'draft' ? { action_type: 'amber' as const, message: '<strong>Manager</strong> saved a draft' }
    : firstSubmit      ? { action_type: 'green' as const, message: '<strong>Manager</strong> submitted the plan' }
    :                    { action_type: 'navy'  as const, message: '<strong>Manager</strong> updated the plan' }
  await admin.from('audit_log').insert({ user_id: id, performed_by: user.id, ...audit })

  if (firstSubmit) {
    const { data: hire } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
    await queueNotification({
      template:  'manager_plan_submitted',
      to:        hrNotifyEmails(),
      dedupeKey: `manager_plan_submitted:${id}`,
      payload:   {
        newhireId: id,
        managerId: existing.manager_id,
        hireName:  hire?.full_name ?? '',
        link:      appUrl(`/hr/newhire/${id}`),
      },
    })
  }

  return NextResponse.json({ ok: true, status: saved[0].status, submitted_at: submittedAt })
}
