import type { Region } from './regions'

// Placeholder branch list. The manager plan no longer asks for a branch (Prompt M1); kept for now.
export const BRANCHES = ['Dartmouth NS', 'Moncton NB', 'Oakville ON', 'Toronto ON'] as const
export type Branch = typeof BRANCHES[number]

// The only office → region mapping in the app. Region values come from lib/regions.ts.
// Remote has no region of its own: HR chooses one for each remote hire.
export const REMOTE_OFFICE = 'Remote'

export const OFFICE_REGIONS: Record<string, Region | null> = {
  'Oakville ON':  'Ontario',
  'Toronto ON':   'Ontario',
  'Moncton NB':   'New Brunswick',
  'Dartmouth NS': 'Nova Scotia',
  [REMOTE_OFFICE]: null,
}

// Region for an office, or null for Remote and anything unknown
export function regionForOffice(office: string | null | undefined): Region | null {
  return office ? OFFICE_REGIONS[office.trim()] ?? null : null
}

export function isRemoteOffice(office: string | null | undefined): boolean {
  return (office ?? '').trim() === REMOTE_OFFICE
}
