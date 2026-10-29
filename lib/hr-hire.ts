import type { AuditEntry, FormStatus } from '@/types'

// Tabs, forms and the overview shape for the HR hire page. Shared by the page and
// GET /api/hr/hires/[id]/overview. No server imports.

export const HIRE_TABS = ['overview', 'forms', 'equipment', 'plan', 'clearance', 'activity'] as const
export type HireTab = typeof HIRE_TABS[number]

export const HIRE_TAB_LABELS: Record<HireTab, string> = {
  overview:  'Overview',
  forms:     'Forms & Documents',
  equipment: 'Equipment',
  plan:      'Plan & Project',
  clearance: 'Clearance',
  activity:  'Notes & Activity',
}

export function isHireTab(value: unknown): value is HireTab {
  return typeof value === 'string' && (HIRE_TABS as readonly string[]).includes(value)
}

// The four forms computeHireStatus reads, in checklist order
export const HIRE_FORMS = ['personal', 'banking', 'sin', 'policy'] as const
export type HireFormId = typeof HIRE_FORMS[number]

export const HIRE_FORM_LABELS: Record<HireFormId, string> = {
  personal: 'Personal Information',
  banking:  'Banking & Direct Deposit',
  sin:      'Social Insurance Number',
  policy:   'Policy Acknowledgement',
}

export function isHireForm(value: unknown): value is HireFormId {
  return typeof value === 'string' && (HIRE_FORMS as readonly string[]).includes(value)
}

// Pill and bar tones. Every pill also carries its meaning in text.
export type Tone = 'green' | 'red' | 'amber' | 'grey' | 'navy' | 'violet' | 'copper'

export type TabBadge = { text: string; tone: Tone }

export type AttentionItem = {
  key:    string
  tone:   Tone
  title:  string
  detail: string
  at:     string | null       // shown as "x days ago" in the browser
  action: string
  tab:    HireTab
  form?:  HireFormId
}

export type AreaCard = {
  key:   string
  title: string
  value: string
  note:  string
  pct:   number              // 0–100
  tone:  Tone
  tab:   HireTab
}

// Read-only, HR only. Statuses, counts and labels: never a sensitive value.
export type HireOverview = {
  forms:              Record<HireFormId, FormStatus>
  approved:           number      // items approved (four forms + Documents), from computeHireStatus
  total_items:        number
  documents:          { status: FormStatus; approved_required: number; total_required: number }
  clearance_required: boolean
  attention:          AttentionItem[]
  areas:              AreaCard[]
  badges:             Partial<Record<HireTab, TabBadge>>
  latest:             Pick<AuditEntry, 'id' | 'action_type' | 'message' | 'created_at'>[]
}
