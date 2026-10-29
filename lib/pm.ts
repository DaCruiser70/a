import { z } from 'zod'
import { REGIONS } from './regions'
import type { ClearanceType, ManagerPlanStatus, PmChip, PmRequestStatus, RegionName } from '@/types'

// Regional project management rules shared by the portal, its routes and the HR views. No server imports.

export function isRegion(value: unknown): value is RegionName {
  return typeof value === 'string' && (REGIONS as readonly string[]).includes(value)
}

// A hire needs a project-management request once the manager submits a plan with PSPC & RCMP
export function needsPmRequest(
  plan: { status: ManagerPlanStatus; clearance_type: ClearanceType | null } | null | undefined,
): boolean {
  return !!plan && plan.status === 'submitted' && plan.clearance_type === 'pspc_rcmp'
}

export const PM_STATUS_LABELS: Record<PmRequestStatus, string> = {
  open:      'Open',
  claimed:   'Claimed',
  done:      'Done',
  cancelled: 'Cancelled',
}

export const PM_TABS = ['open', 'mine', 'done'] as const
export type PmTab = typeof PM_TABS[number]

// "jane.doe@aemltd.com" → "j•••@aemltd.com". Full addresses never leave the server at sign-in.
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '•••'
  return `${local[0]}•••@${domain}`
}

// HR chip state for one hire
export function pmChipState(
  needed: boolean,
  request: { status: PmRequestStatus } | null | undefined,
  hireRegion: unknown,
): PmChip | null {
  if (!needed) return null
  if (request && request.status !== 'cancelled') return request.status as Exclude<PmRequestStatus, 'cancelled'>
  return isRegion(hireRegion) ? null : 'needs_region'
}

export const PM_CHIP_LABELS: Record<PmChip, string> = {
  open:         'Open',
  claimed:      'Claimed',
  done:         'Done',
  needs_region: 'Set region',
}

// ── Project details (entered by project management on the request) ───────────

export const PM_DETAIL_FIELDS = ['dcc', 'standing_offer', 'project_name', 'project_location'] as const
export type PmDetailField = typeof PM_DETAIL_FIELDS[number]
export type PmDetails = Record<PmDetailField, string | null>

export const PM_DETAIL_LABELS: Record<PmDetailField, string> = {
  dcc:              'DCC',
  standing_offer:   'Standing Offer',
  project_name:     'Project name',
  project_location: 'Location',
}

export const PM_DETAIL_MAX: Record<PmDetailField, number> = {
  dcc:              100,
  standing_offer:   100,
  project_name:     200,
  project_location: 300,
}

// Required before "Mark done". Edit this one line to change which fields are required.
export const PM_REQUIRED_FIELDS: readonly PmDetailField[] = ['project_name', 'project_location']

export function isPmFieldRequired(field: PmDetailField): boolean {
  return PM_REQUIRED_FIELDS.includes(field)
}

// Required fields still empty, in form order
export function missingPmFields(details: Partial<PmDetails> | null | undefined): PmDetailField[] {
  return PM_DETAIL_FIELDS.filter(f => isPmFieldRequired(f) && !details?.[f]?.trim())
}

const detailText = (field: PmDetailField) =>
  z.string().trim().max(PM_DETAIL_MAX[field], `Please keep this under ${PM_DETAIL_MAX[field]} characters.`)

// Save: any field may be empty (empty is stored as null)
export const PmDetailsSchema = z.strictObject({
  dcc:              detailText('dcc'),
  standing_offer:   detailText('standing_offer'),
  project_name:     detailText('project_name'),
  project_location: detailText('project_location'),
})

export function emptyPmDetails(): PmDetails {
  return { dcc: null, standing_offer: null, project_name: null, project_location: null }
}

// ── Project block (HR clearance tracker and the "Copy PSPC email details" text) ──

// Manager plan: project number and region. Project management: the four details.
export type PmProjectBlock = PmDetails & { project_number: string | null; project_region: string | null }

const BLOCK_ORDER = ['project_number', 'project_name', 'dcc', 'standing_offer', 'project_location', 'project_region'] as const
const BLOCK_LABELS: Record<typeof BLOCK_ORDER[number], string> = {
  project_number:   'Project number',
  project_name:     PM_DETAIL_LABELS.project_name,
  dcc:              PM_DETAIL_LABELS.dcc,
  standing_offer:   PM_DETAIL_LABELS.standing_offer,
  project_location: PM_DETAIL_LABELS.project_location,
  project_region:   'Region',
}

// Rows in a fixed order. An empty optional field is left out instead of showing a blank label.
export function projectBlockRows(block: PmProjectBlock): { key: string; label: string; value: string | null }[] {
  return BLOCK_ORDER
    .filter(k => !!block[k]?.trim() || !(PM_DETAIL_FIELDS as readonly string[]).includes(k) || isPmFieldRequired(k as PmDetailField))
    .map(k => ({ key: k, label: BLOCK_LABELS[k], value: block[k]?.trim() || null }))
}
