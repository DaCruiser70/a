// Maps equipment item IDs to the stakeholder email(s) responsible for them.
// Items not listed here have no stakeholder and are skipped during notification.
// Company Vehicle is not here: it is a sequence (VEHICLE_STEP_EMAILS below), not one task per person.
// Gas Card was removed from provisioning (its old tasks stay in stakeholder_tasks, untouched).
export const STAKEHOLDER_MAP: Record<string, string[]> = {
  access:        ['gboudreau@aemltd.com'],
  jonas_regular: ['melement@aemltd.com'],
  jonas_emobile: ['melement@aemltd.com'],
}

// Company Vehicle, in order. These are existing stakeholder accounts, looked up by profiles.aem_email
// (and the 'stakeholder' role):
//   rob      Rob Lloyd: fills the vehicle details
//   heather  Heather Hunter: checks, edits and completes them
//   marley   Marley Element: vehicle insurance (the same account that has the Jonas tasks)
// Morley Norman is no longer part of the vehicle process.
export const VEHICLE_STEP_EMAILS = {
  rob:     'rlloyd@aemltd.com',
  heather: 'hhunter@aemltd.com',
  marley:  'melement@aemltd.com',
} as const

// Task keys retired from provisioning: never generated again and not shown in active lists
export const RETIRED_TASK_KEYS: readonly string[] = ['gascard']

// Human-readable labels matching EQUIPMENT_LIST in the HR detail page.
// Only items that are mapped to a stakeholder need a label here — the
// notify route uses this to set task_name when inserting stakeholder_tasks rows.
export const EQUIPMENT_LABELS: Record<string, string> = {
  laptop:        'Laptop / Computer',
  phone:         'Mobile Phone',
  software:      'Software Licenses',
  access:        'Access Card / Key Fob',
  vehicle:       'Company Vehicle',
  training:      'Safety Training',
  jonas_regular: 'Jonas Access — Regular',
  jonas_emobile: 'Jonas Access — e-Mobile',
}
