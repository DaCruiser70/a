import type { ClearanceStatus, ClearanceType, FormStatus, ManagerPlanStatus } from '@/types'
import { ID_DOCUMENT_TYPES } from './required-documents'
import { regionForOffice, isRemoteOffice } from './branches'

// Security clearance rules shared by the hire's form, its API routes and the HR views.
// No server imports.
//
// Clearance is tracked on its own. It never feeds computeHireStatus, the account status, the
// progress percentage, any "x of 4" counter or the payroll queue.

// ── Who needs it ──────────────────────────────────────────────────────────────

export type ClearanceRequirements = {
  required:    boolean
  type:        Exclude<ClearanceType, 'none'> | null
  fingerprint: boolean   // PSPC & RCMP only
  rcmp:        boolean   // RCMP only and PSPC & RCMP
}

const NOT_REQUIRED: ClearanceRequirements = { required: false, type: null, fingerprint: false, rcmp: false }

// Required only once the manager has submitted the plan with clearance 'rcmp' or 'pspc_rcmp'.
// If the manager later switches to 'none', the form disappears and the stored data is kept.
export function getClearanceRequirements(
  plan: { status: ManagerPlanStatus; clearance_type: ClearanceType | null } | null | undefined,
): ClearanceRequirements {
  if (!plan || plan.status !== 'submitted') return NOT_REQUIRED
  if (plan.clearance_type === 'rcmp')      return { required: true, type: 'rcmp',      fingerprint: false, rcmp: true }
  if (plan.clearance_type === 'pspc_rcmp') return { required: true, type: 'pspc_rcmp', fingerprint: true,  rcmp: true }
  return NOT_REQUIRED
}

// ── Status ───────────────────────────────────────────────────────────────────

export function computeClearanceStatus(formStatus: FormStatus | null | undefined): ClearanceStatus {
  return formStatus ?? 'pending'
}

export const CLEARANCE_STATUS_LABELS: Record<ClearanceStatus, string> = {
  pending:  'Not submitted',
  review:   'Needs review',
  approved: 'Approved',
  flagged:  'Flagged',
}

// ── Files ────────────────────────────────────────────────────────────────────

export const CLEARANCE_FILES_BUCKET     = 'clearance-files'
export const CLEARANCE_TEMPLATES_BUCKET = 'clearance-templates'
export const CLEARANCE_MAX_BYTES        = 10 * 1024 * 1024

export const CLEARANCE_KINDS = ['fingerprint', 'rcmp'] as const
export type ClearanceKind = typeof CLEARANCE_KINDS[number]

export function isClearanceKind(value: unknown): value is ClearanceKind {
  return typeof value === 'string' && (CLEARANCE_KINDS as readonly string[]).includes(value)
}

// Allowed extension → content type, per kind. Anything else is rejected (.xls and .xlsm included).
export const CLEARANCE_FILE_TYPES: Record<ClearanceKind, Record<string, string>> = {
  fingerprint: {
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    pdf:  'application/pdf',
  },
  rcmp: {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    pdf:  'application/pdf',
  },
}

// Fixed template objects in clearance-templates
export const CLEARANCE_TEMPLATE_FILES: Record<ClearanceKind, string> = {
  fingerprint: 'fingerprint-form.pdf',
  rcmp:        'rcmp-form.xlsx',
}

// The only path a hire's upload may have: {userId}/{kind}.{ext}
export function clearancePath(userId: string, kind: ClearanceKind, ext: string): string {
  return `${userId}/${kind}.${ext}`
}

export function fileExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

// ── DCN (Document Control Number from the fingerprint provider) ─────────────

export function normalizeDcn(value: string): string {
  return value.replace(/[\s-]/g, '')
}

export function isValidDcn(digits: string): boolean {
  return /^\d{20}$/.test(digits)
}

// 20 digits shown as 5-5-5-5
export function formatDcn(digits: string): string {
  return (digits.match(/.{1,5}/g) ?? []).join('-')
}

// ── ID: read from the existing documents (real document_type values) ────────

// The accepted ID types come from the one required-documents setting (either one is enough)
export const CLEARANCE_ID_DOC_TYPES = ID_DOCUMENT_TYPES

// ── Who each package goes to ─────────────────────────────────────────────────

export type Recipient = { key: string; name: string; email: string }

export const PSPC_RECIPIENT: Recipient = { key: 'pspc', name: 'Michelle Allen', email: 'mallen@aemltd.com' }

export const RCMP_RECIPIENTS = {
  ontario:  { key: 'ontario',  name: 'Trevor Desjardins', email: 'Trevor.Desjardins@bgis.com' },
  atlantic: { key: 'atlantic', name: 'Emily Hahlweg',     email: 'Emily.Hahlweg@bgis.com' },
} as const satisfies Record<string, Recipient>
export type RcmpRecipientKey = keyof typeof RCMP_RECIPIENTS

// Office → region comes from lib/branches.ts (the only place that mapping lives).
// Ontario → Trevor; New Brunswick / Nova Scotia → Emily; Remote → HR chooses (null here).
export function rcmpRecipientForOffice(office: string | null | undefined): RcmpRecipientKey | null {
  const region = regionForOffice(office)
  if (region === 'Ontario') return 'ontario'
  if (region === 'New Brunswick' || region === 'Nova Scotia') return 'atlantic'
  return null
}

export { isRemoteOffice }

// ── PSPC & RCMP package (sent to the clearance reviewer) ─────────────────────

export const PACKAGE_STAGES = ['needs_review', 'in_process', 'done', 'returned'] as const
export type PackageStage = typeof PACKAGE_STAGES[number]

export const PACKAGE_STAGE_LABELS: Record<PackageStage, string> = {
  needs_review: 'Needs review',
  in_process:   'In process',
  done:         'Done',
  returned:     'Returned to HR',
}

export function isPackageStage(value: unknown): value is PackageStage {
  return typeof value === 'string' && (PACKAGE_STAGES as readonly string[]).includes(value)
}

// The reviewer's moves. The server checks the same table (and the database function again).
export const REVIEWER_ACTIONS = ['start', 'done', 'return'] as const
export type ReviewerAction = typeof REVIEWER_ACTIONS[number]
export const REVIEWER_MOVES: Record<ReviewerAction, { from: PackageStage[]; to: PackageStage; label: string }> = {
  start:  { from: ['needs_review'],               to: 'in_process', label: 'Move to In process' },
  done:   { from: ['in_process'],                 to: 'done',       label: 'Mark Done' },
  return: { from: ['needs_review', 'in_process'], to: 'returned',   label: 'Send back to HR' },
}

// Once sent, HR cannot reject or change the forms until the reviewer returns the package
export function packageLocked(stage: PackageStage | null | undefined): boolean {
  return stage === 'needs_review' || stage === 'in_process' || stage === 'done'
}

export const RETURN_NOTE_MAX = 1000

// Per-form review on clearance_info
export type FileReview = 'pending' | 'approved' | 'rejected'
export const FILE_REVIEW_LABELS: Record<FileReview, string> = {
  pending:  'Needs review',
  approved: 'Approved',
  rejected: 'Rejected',
}
