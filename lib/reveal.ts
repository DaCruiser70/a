// Reveal groups for a hire's sensitive fields. Shared by the HR page and the reveal routes.
// No server imports.

// HR and payroll reveal these (the HR and payroll routes accept only this list).
// 'personal': the date of birth and personal phone from Personal Information.
export const REVEAL_GROUPS = ['banking', 'sin', 'personal'] as const
// The clearance reviewer reveals the hire's clearance details through the same emailed-code flow
export const CLEARANCE_REVEAL_GROUP = 'clearance' as const
export type RevealGroup = typeof REVEAL_GROUPS[number] | typeof CLEARANCE_REVEAL_GROUP

export const REVEAL_GROUP_LABELS: Record<RevealGroup, string> = {
  banking:   'banking numbers',
  sin:       'Social Insurance Number',
  personal:  'personal details',
  clearance: 'clearance details',
}

// How long revealed values stay on screen before they are cleared from the page
export const REVEAL_VISIBLE_SECONDS = 60
// Resend cooldown in the reveal dialog
export const REVEAL_RESEND_SECONDS = 30
