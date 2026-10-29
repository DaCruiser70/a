// Audit log categories for the HR hire page's Activity filter. No server imports.
//
// audit_log rows have no action name, only a colour and a message, so a category is chosen from the
// message wording. Rules are checked in order and the first match wins; anything unmatched is
// Other. The same rules filter on the server (ilike) and in the browser, so both always agree.
// Patterns are plain lowercase substrings: no commas, brackets, % or _ (they go into PostgREST
// filters as-is). A name or document label inside a message can occasionally match a pattern.

export const AUDIT_CATEGORIES = ['all', 'forms', 'equipment', 'plan', 'clearance', 'access', 'other'] as const
export type AuditCategory = typeof AUDIT_CATEGORIES[number]

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  all:       'All',
  forms:     'Forms',
  equipment: 'Equipment',
  plan:      'Plan',
  clearance: 'Clearance',
  access:    'Access',
  other:     'Other',
}

type MatchedCategory = Exclude<AuditCategory, 'all' | 'other'>

// Order matters: viewing a clearance file is Access, a plan saved by a manager is Plan, and so on.
export const AUDIT_RULES: { category: MatchedCategory; patterns: string[] }[] = [
  // Includes SIN / banking reveals and their codes (requested, wrong, used up, expired) and
  // "opened the HR record for …"
  { category: 'access',    patterns: [' viewed ', ' downloaded ', ' revealed ', ' accessed ', ' copied ', 'reveal code', 'opened the hr record'] },
  { category: 'clearance', patterns: ['clearance', 'pspc', 'rcmp', 'fingerprint'] },
  { category: 'equipment', patterns: ['equipment', 'provisioning', 'stakeholder'] },
  { category: 'plan',      patterns: ['plan', 'draft', 'reporting manager', 'project management', 'project details', 'region'] },
  { category: 'forms',     patterns: ['form', 'banking', 'social insurance', 'personal information', 'void cheque', 'document', 'td1'] },
]

export function categorizeAudit(message: string): Exclude<AuditCategory, 'all'> {
  const text = message.toLowerCase()
  for (const rule of AUDIT_RULES) {
    if (rule.patterns.some(p => text.includes(p))) return rule.category
  }
  return 'other'
}

export function isAuditCategory(value: unknown): value is AuditCategory {
  return typeof value === 'string' && (AUDIT_CATEGORIES as readonly string[]).includes(value)
}
