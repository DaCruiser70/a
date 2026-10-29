import type { HireStatus } from '@/types'

// HR dashboard: filters, sort order and the row shape returned by GET /api/hr/dashboard.
// No server imports.

export const DASH_PAGE_SIZE = 8

export const DASH_FILTERS = ['all', 'attention', 'needs-review', 'flagged', 'in-progress', 'approved'] as const
export type DashFilter = typeof DASH_FILTERS[number]

export const DASH_FILTER_LABELS: Record<DashFilter, string> = {
  'all':          'All',
  'attention':    'Needs attention',
  'needs-review': 'Needs review',
  'flagged':      'Flagged',
  'in-progress':  'In progress',
  'approved':     'Approved',
}

export function matchesFilter(status: HireStatus, filter: DashFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'attention') return status === 'flagged' || status === 'needs-review'
  return status === filter
}

// Flagged first, then Needs review, In progress, Not started, Approved
export const STATUS_ORDER: Record<HireStatus, number> = {
  'flagged':      0,
  'needs-review': 1,
  'in-progress':  2,
  'not-started':  3,
  'approved':     4,
}

export const DASH_STATUS_LABELS: Record<HireStatus, string> = {
  'flagged':      'Flagged',
  'needs-review': 'Needs review',
  'in-progress':  'In progress',
  'not-started':  'Not started',
  'approved':     'Approved',
}

export type DashRow = {
  id:              string
  name:            string
  email:           string
  role:            string
  office_location: string | null
  start_date:      string | null
  status:          HireStatus
  approved:        number        // items approved, of TOTAL_ITEMS (four forms + Documents), from computeHireStatus
  next_step:       string        // one plain line, built on the server
}

export type DashActivity = { id: string; text: string; at: string; tone: 'navy' | 'green' | 'red' | 'violet' | 'copper' }

export type DashResponse = {
  hires:        DashRow[]
  total:        number           // rows matching the filter and search
  page:         number
  pages:        number
  counts:       Record<DashFilter, number>   // per chip, with the search applied
  stats:        { active: number; needsReview: number; flagged: number; approved: number; startingThisMonth: number }
  startingSoon: { id: string; name: string; role: string; start_date: string }[]
  activity:     DashActivity[]
}
