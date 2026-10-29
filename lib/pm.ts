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
