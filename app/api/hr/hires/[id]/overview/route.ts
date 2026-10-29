import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { computeHireStatus } from '@/lib/hire-status'
import { planChip, PLAN_CHIP_LABELS, CLEARANCE_LABELS, todayIso } from '@/lib/manager-plan'
import { getClearanceRequirements, computeClearanceStatus, CLEARANCE_STATUS_LABELS, PACKAGE_STAGE_LABELS } from '@/lib/clearance'
import { needsPmRequest, pmChipState, PM_CHIP_LABELS } from '@/lib/pm'
import { memberNames } from '@/lib/pm-server'
import { equipmentProgress } from '@/lib/equipment-items'
import {
  HIRE_FORMS, HIRE_FORM_LABELS,
  type AreaCard, type AttentionItem, type HireOverview, type TabBadge,
} from '@/lib/hr-hire'
import type { FormStatus } from '@/types'

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso)
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'America/Toronto' })
}

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0)

// HR hire page: the "Needs your attention" list, "Progress by area" cards, tab badges and the last
// three audit entries. Read-only and HR only. Built from the same tables and helpers as the rest of
// the page; it returns statuses, counts and labels, never a form value, number or file path.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  const admin = createServiceClient()
  const [
    { data: profile },
    { data: personal }, { data: banking }, { data: sin }, { data: policy },
    { data: docs }, { data: equipment }, { data: tasks },
    { data: plan }, { data: clearanceInfo }, { data: tracking }, { data: pm },
    { data: latest },
  ] = await Promise.all([
    admin.from('profiles').select('id, status, region, employee_id, payroll_completed_at').eq('id', id).maybeSingle(),
    admin.from('personal_info').select('form_status, submitted_at').eq('user_id', id).maybeSingle(),
    admin.from('banking_info').select('form_status, submitted_at').eq('user_id', id).maybeSingle(),
    admin.from('sin_info').select('form_status, submitted_at').eq('user_id', id).maybeSingle(),
    admin.from('policy_acknowledgements').select('form_status, submitted_at').eq('user_id', id).maybeSingle(),
    admin.from('newhire_documents').select('document_type, form_status, uploaded_at').eq('user_id', id),
    admin.from('equipment_provisioning').select('items').eq('user_id', id).maybeSingle(),
    admin.from('stakeholder_tasks').select('task_key, status').eq('newhire_id', id),
    admin.from('manager_plans').select('status, due_date, submitted_at, clearance_type, manager_id').eq('newhire_id', id).maybeSingle(),
    admin.from('clearance_info').select('form_status, submitted_at').eq('user_id', id).maybeSingle(),
    admin.from('clearance_tracking').select('cleared_at, package_stage, sent_to_bgis').eq('newhire_id', id).maybeSingle(),
    admin.from('pm_requests').select('status, region, claimed_by, completed_at').eq('newhire_id', id).maybeSingle(),
    admin.from('audit_log').select('id, action_type, message, created_at').eq('user_id', id)
      .order('created_at', { ascending: false }).limit(3),
  ])
  if (!profile) return NOT_FOUND()

  const today = todayIso()

  // ── Forms ──
  const formRows = { personal, banking, sin, policy }
  const forms = Object.fromEntries(HIRE_FORMS.map(f => [f, (formRows[f]?.form_status ?? 'pending') as FormStatus])) as HireOverview['forms']
  const computed = computeHireStatus(HIRE_FORMS.map(f => forms[f]), docs ?? [])
  const docItem  = computed.documents
  const flagged  = HIRE_FORMS.filter(f => forms[f] === 'flagged')
  const inReview = HIRE_FORMS.filter(f => forms[f] === 'review')

  // ── Documents ──
  const docList    = docs ?? []
  const docsReview = docList.filter(d => d.form_status === 'review')
  const docsBad    = docList.filter(d => d.form_status === 'rejected').length

  // ── Equipment ──
  const { data: vehicle } = await admin.from('vehicle_requests').select('step').eq('newhire_id', id).maybeSingle()
  const equip = equipmentProgress((equipment?.items as Record<string, boolean> | null) ?? {}, tasks ?? [], vehicle?.step ?? null)

  // ── Manager plan ──
  const chip = planChip(plan, today)
  const { data: manager } = plan?.manager_id
    ? await admin.from('managers').select('full_name').eq('id', plan.manager_id).maybeSingle()
    : { data: null }

  // ── Clearance (tracked apart from the four forms) ──
  const clr       = getClearanceRequirements(plan)
  const clrStatus = clr.required ? computeClearanceStatus(clearanceInfo?.form_status) : null
  // Finished from the portal's side: the reviewer marked the PSPC & RCMP package Done, HR ticked
  // "Sent to BGIS" for an RCMP-only clearance, or the older manual "cleared" mark
  const cleared   = !!tracking?.cleared_at || tracking?.package_stage === 'done' || (clr.type === 'rcmp' && !!tracking?.sent_to_bgis)
  const pkgStage  = clr.type === 'pspc_rcmp' ? tracking?.package_stage ?? null : null

  // ── Project management ──
  const pmNeeded = needsPmRequest(plan)
  const pmState  = pmChipState(pmNeeded, pm, profile.region)
  const claimer  = pmState === 'claimed' && pm?.claimed_by ? (await memberNames(admin, [pm.claimed_by]))[pm.claimed_by] ?? null : null

  // ── Needs your attention, in priority order ──
  const attention: AttentionItem[] = []
  for (const f of flagged) {
    attention.push({ key: `flagged-${f}`, tone: 'red', title: `${HIRE_FORM_LABELS[f]} is flagged`,
      detail: 'Waiting for the new hire to resubmit.', at: null, action: 'Open form', tab: 'forms', form: f })
  }
  for (const f of inReview) {
    attention.push({ key: `review-${f}`, tone: 'amber', title: `${HIRE_FORM_LABELS[f]} needs your review`,
      detail: 'Submitted', at: formRows[f]?.submitted_at ?? null, action: 'Review', tab: 'forms', form: f })
  }
  if (docsReview.length > 0) {
    attention.push({ key: 'documents', tone: 'amber',
      title: docsReview.length === 1 ? '1 document needs your review' : `${docsReview.length} documents need your review`,
      detail: 'Uploaded', at: docsReview.map(d => d.uploaded_at).sort()[0] ?? null, action: 'Review documents', tab: 'forms' })
  }
  if (docItem.flagged.length > 0) {
    attention.push({ key: 'documents-flagged', tone: 'red',
      title: docItem.flagged.length === 1 ? 'A required document was rejected' : `${docItem.flagged.length} required documents were rejected`,
      detail: `Waiting for the new hire to upload ${docItem.flagged.join(' and ')} again.`, at: null, action: 'Open documents', tab: 'forms' })
  }
  if (clr.required && clrStatus === 'review') {
    attention.push({ key: 'clearance', tone: 'amber', title: 'Security clearance form needs your review',
      detail: `${CLEARANCE_LABELS[clr.type!]}. Tracked separately from the four forms.`, at: clearanceInfo?.submitted_at ?? null,
      action: 'Open clearance', tab: 'clearance' })
  }
  if (pkgStage === 'returned') {
    attention.push({ key: 'clearance-returned', tone: 'red', title: 'Clearance package sent back by the reviewer',
      detail: 'Read the reviewer’s note, fix it, then resend.', at: null, action: 'Open clearance', tab: 'clearance' })
  }
  if (pmState === 'needs_region') {
    attention.push({ key: 'pm', tone: 'red', title: 'Set a region for project management',
      detail: 'The PSPC & RCMP request opens for that region’s team once a region is set.', at: null, action: 'Set region', tab: 'overview' })
  } else if (pmState === 'open' || pmState === 'claimed') {
    attention.push({ key: 'pm', tone: 'copper',
      title: pmState === 'open' ? 'Project management request is waiting to be claimed' : 'Project management request is in progress',
      detail: pmState === 'claimed' ? `Claimed by ${claimer ?? 'a team member'}.` : `${pm?.region ?? 'Regional'} team.`,
      at: null, action: 'Open plan & project', tab: 'plan' })
  }
  if (chip === 'overdue') {
    attention.push({ key: 'plan', tone: 'red', title: 'Manager plan is overdue',
      detail: `${manager?.full_name ?? 'The manager'} has not submitted it${plan?.due_date ? `. Due ${shortDate(plan.due_date)}` : ''}.`,
      at: null, action: 'Open plan', tab: 'plan' })
  } else if (chip === 'awaiting' || chip === 'draft') {
    attention.push({ key: 'plan', tone: 'grey', title: chip === 'draft' ? 'Manager plan is in draft' : 'Manager plan not submitted yet',
      detail: `Waiting on ${manager?.full_name ?? 'the manager'}${plan?.due_date ? `. Due ${shortDate(plan.due_date)}` : ''}.`,
      at: null, action: 'Open plan', tab: 'plan' })
  }

  // ── Progress by area ──
  const formNote = [flagged.length && `${flagged.length} flagged`, inReview.length && `${inReview.length} need review`]
    .filter(Boolean).join(', ') || (computed.formsApproved === 4 ? 'All four approved' : 'Nothing waiting on HR')
  const areas: AreaCard[] = [
    { key: 'forms', title: 'Forms', tab: 'forms', tone: 'green',
      value: `${computed.formsApproved} of 4 approved`, pct: pct(computed.formsApproved, 4), note: formNote },
    // Required documents only (lib/required-documents.ts); optional uploads never count
    { key: 'documents', title: 'Documents', tab: 'forms', tone: docItem.status === 'flagged' ? 'red' : 'navy',
      value: `${docItem.approvedRequired} of ${docItem.totalRequired} required approved`,
      pct: pct(docItem.approvedRequired, docItem.totalRequired),
      note: docItem.flagged.length ? `Rejected: ${docItem.flagged.join(', ')}`
        : docItem.missing.length === 1 ? `Waiting on hire: ${docItem.missing[0]}`
        : docItem.missing.length > 1 ? `Waiting on hire: ${docItem.missing.length} documents`
        : docsReview.length ? `${docsReview.length} waiting on your review`
        : docsBad ? `${docsBad} optional rejected` : 'All required approved' },
    { key: 'equipment', title: 'Equipment', tab: 'equipment', tone: 'amber',
      value: `${equip.done} of ${equip.total} issued`, pct: pct(equip.done, equip.total),
      note: equip.awaiting ? `${equip.awaiting} awaiting stakeholder confirmation` : equip.done ? 'No confirmations outstanding' : 'Nothing issued yet' },
    { key: 'plan', title: 'Manager plan', tab: 'plan', tone: chip === 'overdue' ? 'red' : 'violet',
      value: chip ? PLAN_CHIP_LABELS[chip] : 'Not requested',
      pct: chip === 'submitted' ? 100 : chip === 'draft' ? 50 : 0,
      note: chip === 'submitted'
        ? [manager?.full_name, shortDate(plan?.submitted_at)].filter(Boolean).join(', ')
        : plan ? `${manager?.full_name ?? 'Manager'}${plan.due_date ? `, due ${shortDate(plan.due_date)}` : ''}` : 'No plan has been requested' },
    { key: 'pm', title: 'Project management', tab: 'plan', tone: 'copper',
      value: pmState ? PM_CHIP_LABELS[pmState] : 'Not needed',
      pct: pmState === 'done' ? 100 : pmState === 'claimed' ? 50 : 0,
      note: !pmState ? 'Only for PSPC & RCMP clearances'
        : pmState === 'needs_region' ? 'The hire needs a region first'
        : pmState === 'done' ? [`${pm?.region ?? 'Regional'} team`, shortDate(pm?.completed_at)].filter(Boolean).join(', ')
        : pmState === 'claimed' ? `Claimed by ${claimer ?? 'a team member'}` : `${pm?.region ?? 'Regional'} team` },
  ]
  if (clr.required && clrStatus) {
    areas.push({ key: 'clearance', title: 'Clearance', tab: 'clearance', tone: clrStatus === 'flagged' ? 'red' : 'grey',
      value: cleared ? (clr.type === 'rcmp' ? 'Sent to BGIS' : 'Done') : pkgStage ? `Package: ${PACKAGE_STAGE_LABELS[pkgStage]}` : CLEARANCE_STATUS_LABELS[clrStatus],
      pct: cleared ? 100 : pkgStage === 'in_process' ? 85 : pkgStage ? 75 : clrStatus === 'approved' ? 60 : clrStatus === 'review' ? 40 : 0,
      note: `${CLEARANCE_LABELS[clr.type!]}, tracked separately` })
  }
  const payrollDone = !!profile.payroll_completed_at
  const inPayroll   = profile.status === 'approved'
  areas.push({ key: 'payroll', title: 'Payroll', tab: 'overview', tone: 'green',
    value: payrollDone ? 'Complete' : inPayroll ? 'In payroll queue' : 'Waiting',
    pct: payrollDone ? 100 : inPayroll ? 50 : 0,
    note: payrollDone ? `Employee ID assigned ${shortDate(profile.payroll_completed_at)}`
      : inPayroll ? 'Waiting for payroll to assign an employee ID' : 'Opens after HR approves all four forms' })

  // ── Tab badges ──
  const planOverdue = chip === 'overdue'
  const planProjectDone = chip === 'submitted' && (!pmState || pmState === 'done')
  const badges: HireOverview['badges'] = {
    // Forms & Documents tab: the 5 items (four forms + Documents)
    forms: flagged.length + (docItem.status === 'flagged' ? 1 : 0)
      ? { text: `${flagged.length + (docItem.status === 'flagged' ? 1 : 0)} flagged`, tone: 'red' }
      : { text: `${computed.approvedCount}/${computed.totalItems}`, tone: computed.approvedCount === computed.totalItems ? 'green' : 'grey' },
    equipment: { text: `${equip.done}/${equip.total}`, tone: equip.done === equip.total ? 'green' : 'grey' },
    plan: planOverdue ? { text: 'Overdue', tone: 'red' }
      : planProjectDone ? { text: 'Done', tone: 'green' }
      : { text: 'Open', tone: 'amber' },
  }
  if (clr.required && clrStatus) {
    const clrBadge: Record<string, TabBadge> = {
      pending:  { text: 'Waiting',  tone: 'amber' },
      review:   { text: 'Review',   tone: 'amber' },
      approved: { text: 'Approved', tone: 'green' },
      flagged:  { text: 'Flagged',  tone: 'red' },
    }
    badges.clearance = cleared ? { text: 'Done', tone: 'green' }
      : pkgStage === 'returned' ? { text: 'Returned', tone: 'red' }
      : pkgStage ? { text: PACKAGE_STAGE_LABELS[pkgStage], tone: 'navy' }
      : clrBadge[clrStatus]
  }

  const body: HireOverview = {
    forms,
    approved:           computed.approvedCount,
    total_items:        computed.totalItems,
    documents: {
      status:            docItem.status,
      approved_required: docItem.approvedRequired,
      total_required:    docItem.totalRequired,
    },
    clearance_required: clr.required,
    attention,
    areas,
    badges,
    latest:             latest ?? [],
  }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
