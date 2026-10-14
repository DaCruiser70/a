import { z } from 'zod'
import { REGIONS } from './regions'
import { BRANCHES } from './branches'
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

export const TRAINING_DELIVERY = ['on_the_job', 'internal', 'external_course', 'online'] as const
export type TrainingDelivery = typeof TRAINING_DELIVERY[number]
export const TRAINING_DELIVERY_LABELS: Record<TrainingDelivery, string> = {
  on_the_job:      'On the job',
  internal:        'Internal training',
  external_course: 'External course',
  online:          'Online',
}

export const PLAN_TEXT_FIELDS = [
  'training_needed', 'training_notes', 'week1', 'week2', 'week3',
  'day_one_contact', 'first_day_gear', 'anything_else',
] as const
export const PROJECT_TEXT_FIELDS = ['project_number', 'project_name', 'project_location'] as const

export type PlanAnswers = {
  training_needed:   string
  training_delivery: TrainingDelivery[]
  training_notes:    string
  week1:             string
  week2:             string
  week3:             string
  day_one_contact:   string
  first_day_gear:    string
  anything_else:     string
  clearance_type:    ClearanceType
  project_number:    string
  project_name:      string
  project_region:    string
  project_location:  string
  project_branch:    string
}

export const EMPTY_PLAN: PlanAnswers = {
  training_needed: '', training_delivery: [], training_notes: '',
  week1: '', week2: '', week3: '',
  day_one_contact: '', first_day_gear: '', anything_else: '',
  clearance_type: 'none',
  project_number: '', project_name: '', project_region: '', project_location: '', project_branch: '',
}

const text = z.string().trim().max(MAX_PLAN_TEXT, `Please keep this under ${MAX_PLAN_TEXT} characters.`)
const deliveryList = z.array(z.enum(TRAINING_DELIVERY)).max(TRAINING_DELIVERY.length)
  .refine(v => new Set(v).size === v.length)
const region = z.union([z.enum(REGIONS), z.literal('')])
const branch = z.union([z.enum(BRANCHES), z.literal('')])

// Save draft: any field may be empty
export const PlanDraftSchema = z.strictObject({
  training_needed:   text,
  training_delivery: deliveryList,
  training_notes:    text,
  week1:             text,
  week2:             text,
  week3:             text,
  day_one_contact:   text,
  first_day_gear:    text,
  anything_else:     text,
  clearance_type:    z.enum(CLEARANCE_TYPES),
  project_number:    text,
  project_name:      text,
  project_region:    region,
  project_location:  text,
  project_branch:    branch,
})

const REQUIRED_MESSAGES: Partial<Record<keyof PlanAnswers, string>> = {
  training_needed:   'Describe the training this person needs.',
  training_delivery: 'Choose at least one way they will get the training.',
  week1:             'Add a plan for week 1.',
  week2:             'Add a plan for week 2.',
  week3:             'Add a plan for week 3.',
  project_number:    'Enter the project number.',
  project_name:      'Enter the project name.',
  project_region:    'Choose the project region.',
  project_location:  'Enter the project location.',
  project_branch:    'Choose the branch.',
}

// Submit: training, delivery and weeks 1–3 are required, plus the project fields for PSPC & RCMP
export const PlanSubmitSchema = PlanDraftSchema.superRefine((plan, ctx) => {
  const need = (field: keyof PlanAnswers, missing: boolean) => {
    if (missing) ctx.addIssue({ code: 'custom', path: [field], message: REQUIRED_MESSAGES[field] ?? 'Required.' })
  }
  need('training_needed',   !plan.training_needed)
  need('training_delivery', plan.training_delivery.length === 0)
  need('week1', !plan.week1)
  need('week2', !plan.week2)
  need('week3', !plan.week3)
  if (plan.clearance_type === 'pspc_rcmp') {
    need('project_number',   !plan.project_number)
    need('project_name',     !plan.project_name)
    need('project_region',   !plan.project_region)
    need('project_location', !plan.project_location)
    need('project_branch',   !plan.project_branch)
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
    const key = issue.path[issue.path.length - 1] as keyof PlanAnswers
    if (key && !out[key]) out[key] = issue.message
  }
  return out
}

// Stored row → form answers (nulls become empty strings, unknown values are dropped)
export function answersFromRow(row: Partial<ManagerPlan>): PlanAnswers {
  const delivery = (row.training_delivery ?? []).filter((d): d is TrainingDelivery =>
    (TRAINING_DELIVERY as readonly string[]).includes(d))
  const clearance = (CLEARANCE_TYPES as readonly string[]).includes(row.clearance_type ?? '')
    ? row.clearance_type as ClearanceType
    : 'none'
  return {
    training_needed:   row.training_needed  ?? '',
    training_delivery: delivery,
    training_notes:    row.training_notes   ?? '',
    week1:             row.week1            ?? '',
    week2:             row.week2            ?? '',
    week3:             row.week3            ?? '',
    day_one_contact:   row.day_one_contact  ?? '',
    first_day_gear:    row.first_day_gear   ?? '',
    anything_else:     row.anything_else    ?? '',
    clearance_type:    clearance,
    project_number:    row.project_number   ?? '',
    project_name:      row.project_name     ?? '',
    project_region:    row.project_region   ?? '',
    project_location:  row.project_location ?? '',
    project_branch:    row.project_branch   ?? '',
  }
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
