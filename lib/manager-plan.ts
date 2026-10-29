import { z } from 'zod'
import { REGIONS } from './regions'
import { TRAINING_KEYS, TRAINING_LABELS, TRAINING_OTHER_MAX, isTrainingKey, type TrainingKey } from './training-options'
import type { ManagerPlan, ManagerPlanStatus, ClearanceType, PlanChip } from '@/types'

// Shared by the manager plan form (client validation), its API route (server validation)
// and the HR views. No server imports.

export const MAX_PLAN_TEXT = 2000

export const PLAN_STATUS_LABELS: Record<ManagerPlanStatus, string> = {
  requested: 'Requested',
  draft:     'Draft',
  submitted: 'Submitted',
}

export const CLEARANCE_TYPES = ['none', 'rcmp', 'pspc_rcmp'] as const satisfies readonly ClearanceType[]
export const CLEARANCE_LABELS: Record<ClearanceType, string> = {
  none:      'None',
  rcmp:      'RCMP only',
  pspc_rcmp: 'PSPC & RCMP',
}

// Every manager_plans column the app reads. Queries name these instead of selecting *.
// One string literal (not concatenated) so the typed client can infer the row shape.
export const PLAN_COLUMNS = 'id, newhire_id, manager_id, status, due_date, assignment_seq, training_items, training_other, schedule_wk1_2, schedule_wk2_3, schedule_wk3_4, schedule_month2, schedule_month3, day_one_contact, first_day_gear, anything_else, clearance_type, project_number, project_region, submitted_at, created_at, updated_at'

// ── Current answers ───────────────────────────────────────────────────────────

// The five schedule boxes, in order, with their column names
export const SCHEDULE_FIELDS = [
  'schedule_wk1_2', 'schedule_wk2_3', 'schedule_wk3_4', 'schedule_month2', 'schedule_month3',
] as const
export type ScheduleField = typeof SCHEDULE_FIELDS[number]
export const SCHEDULE_LABELS: Record<ScheduleField, string> = {
  schedule_wk1_2:  'Weeks 1–2',
  schedule_wk2_3:  'Weeks 2–3',
  schedule_wk3_4:  'Weeks 3–4',
  schedule_month2: 'Month 2',
  schedule_month3: 'Month 3',
}

// Free-text columns the plan form writes (the project number is written only under PSPC & RCMP)
export const PLAN_TEXT_FIELDS = [
  ...SCHEDULE_FIELDS, 'day_one_contact', 'first_day_gear', 'anything_else',
] as const

export type PlanAnswers = {
  training_items:          TrainingKey[]
  training_other_selected: boolean   // the "Other" checkbox; not stored, implied by training_other
  training_other:          string
  schedule_wk1_2:          string
  schedule_wk2_3:          string
  schedule_wk3_4:          string
  schedule_month2:         string
  schedule_month3:         string
  day_one_contact:         string
  first_day_gear:          string
  anything_else:           string
  clearance_type:          ClearanceType
  project_number:          string
  project_region:          string
}

export const EMPTY_PLAN: PlanAnswers = {
  training_items: [], training_other_selected: false, training_other: '',
  schedule_wk1_2: '', schedule_wk2_3: '', schedule_wk3_4: '', schedule_month2: '', schedule_month3: '',
  day_one_contact: '', first_day_gear: '', anything_else: '',
  clearance_type: 'none',
  project_number: '', project_region: '',
}

const text = z.string().trim().max(MAX_PLAN_TEXT, `Please keep this under ${MAX_PLAN_TEXT} characters.`)
// Every selected key must be in lib/training-options.ts; no duplicates; selecting nothing is allowed
const trainingItems = z.array(z.enum(TRAINING_KEYS, { error: 'Choose training from the list.' })).max(TRAINING_KEYS.length)
  .refine(v => new Set(v).size === v.length, 'Each training can be chosen once.')
const otherText = z.string().trim().max(TRAINING_OTHER_MAX, `Please keep this under ${TRAINING_OTHER_MAX} characters.`)
const region = z.union([z.enum(REGIONS), z.literal('')])

// Save draft: any field may be empty. Unchecking "Other" clears its text.
export const PlanDraftSchema = z.strictObject({
  training_items:          trainingItems,
  training_other_selected: z.boolean(),
  training_other:          otherText,
  schedule_wk1_2:          text,
  schedule_wk2_3:          text,
  schedule_wk3_4:          text,
  schedule_month2:         text,
  schedule_month3:         text,
  day_one_contact:         text,
  first_day_gear:          text,
  anything_else:           text,
  clearance_type:          z.enum(CLEARANCE_TYPES),
  project_number:          text,
  project_region:          region,
}).transform(plan => ({
  ...plan,
  training_other: plan.training_other_selected ? plan.training_other : '',
}))

const REQUIRED_MESSAGES: Partial<Record<keyof PlanAnswers, string>> = {
  training_other:  'Name the other training, or untick Other.',
  schedule_wk1_2:  'Add a plan for weeks 1–2.',
  schedule_wk2_3:  'Add a plan for weeks 2–3.',
  schedule_wk3_4:  'Add a plan for weeks 3–4.',
  schedule_month2: 'Add a plan for month 2.',
  schedule_month3: 'Add a plan for month 3.',
  project_number:  'Enter the project number.',
  project_region:  'Choose the project region.',
}

// Submit: the five schedule boxes are required (as weeks 1–3 were), plus the project number and
// region for PSPC & RCMP. Safety training may be left empty; a ticked "Other" needs its text.
export const PlanSubmitSchema = PlanDraftSchema.superRefine((plan, ctx) => {
  const need = (field: keyof PlanAnswers, missing: boolean) => {
    if (missing) ctx.addIssue({ code: 'custom', path: [field], message: REQUIRED_MESSAGES[field] ?? 'Required.' })
  }
  need('training_other', plan.training_other_selected && !plan.training_other)
  for (const field of SCHEDULE_FIELDS) need(field, !plan[field])
  if (plan.clearance_type === 'pspc_rcmp') {
    need('project_number', !plan.project_number)
    need('project_region', !plan.project_region)
  }
})

export const PlanPutSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('draft'),  plan: PlanDraftSchema }),
  z.strictObject({ action: z.literal('submit'), plan: PlanSubmitSchema }),
])

// First error message per field, for inline display
export function fieldErrors(error: z.ZodError): Partial<Record<keyof PlanAnswers, string>> {
  const out: Partial<Record<keyof PlanAnswers, string>> = {}
  for (const issue of error.issues) {
    // The last named segment: ['plan', 'schedule_wk1_2'] → schedule_wk1_2, and an error on one
    // entry of training_items (['plan', 'training_items', 1]) is reported against the whole list
    const key = issue.path.findLast(k => typeof k === 'string') as keyof PlanAnswers | undefined
    if (key && !out[key]) out[key] = issue.message
  }
  return out
}

// Stored row → form answers (nulls become empty strings, unknown values are dropped)
export function answersFromRow(row: Partial<ManagerPlan>): PlanAnswers {
  const items = TRAINING_KEYS.filter(k => (row.training_items ?? []).includes(k))
  const clearance = (CLEARANCE_TYPES as readonly string[]).includes(row.clearance_type ?? '')
    ? row.clearance_type as ClearanceType
    : 'none'
  const other = row.training_other?.trim() ?? ''
  return {
    training_items:          items,
    training_other_selected: !!other,
    training_other:          other,
    schedule_wk1_2:          row.schedule_wk1_2  ?? '',
    schedule_wk2_3:          row.schedule_wk2_3  ?? '',
    schedule_wk3_4:          row.schedule_wk3_4  ?? '',
    schedule_month2:         row.schedule_month2 ?? '',
    schedule_month3:         row.schedule_month3 ?? '',
    day_one_contact:         row.day_one_contact ?? '',
    first_day_gear:          row.first_day_gear  ?? '',
    anything_else:           row.anything_else   ?? '',
    clearance_type:          clearance,
    project_number:          row.project_number  ?? '',
    project_region:          row.project_region  ?? '',
  }
}

// Labels for the selected safety training, in list order, with "Other" last
export function trainingSummary(a: Pick<PlanAnswers, 'training_items' | 'training_other'>): string[] {
  const labels = a.training_items.filter(isTrainingKey).map(k => TRAINING_LABELS[k])
  if (a.training_other) labels.push(`Other: ${a.training_other}`)
  return labels
}

// Today as YYYY-MM-DD in Atlantic/Eastern business time is close enough for a due-date badge;
// computed on the server so every viewer sees the same answer.
export function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
}

export function isPlanOverdue(status: ManagerPlanStatus, dueDate: string | null, today: string): boolean {
  return status !== 'submitted' && !!dueDate && dueDate < today
}

export function planChip(
  plan: { status: ManagerPlanStatus; due_date: string | null } | null | undefined,
  today: string,
): PlanChip | null {
  if (!plan) return null
  if (plan.status === 'submitted') return 'submitted'
  if (isPlanOverdue(plan.status, plan.due_date, today)) return 'overdue'
  return plan.status === 'draft' ? 'draft' : 'awaiting'
}

export const PLAN_CHIP_LABELS: Record<PlanChip, string> = {
  awaiting:  'Awaiting',
  draft:     'Draft',
  submitted: 'Submitted',
  overdue:   'Overdue',
}
