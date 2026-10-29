// Safety training checklist for the manager plan. The only list of these options: used by the
// manager form, the plan API schema and the HR display. No server imports.
//
// Keys are stored in manager_plans.training_items. They are stable: never rename or reuse a key.
// Change a label freely; to retire an option, remove it here (stored keys that are no longer
// listed are dropped when the plan is read).

export const TRAINING_KEYS = [
  'first_aid',
  'working_at_heights',
  'lockout_tagout',
  'whmis',
  'fall_protection',
  'confined_space',
  'safety_orientation',
  'heavy_equipment',
  'aerial_work_platform',
  'manlift_online',
] as const
export type TrainingKey = typeof TRAINING_KEYS[number]

export const TRAINING_LABELS: Record<TrainingKey, string> = {
  first_aid:            'First Aid',
  working_at_heights:   'Working At Heights',
  lockout_tagout:       'Lockout Tagout',
  whmis:                'WHMIS',
  fall_protection:      'Fall Protection',
  confined_space:       'Confined Space',
  safety_orientation:   'Safety Orientation',
  heavy_equipment:      'Working Around Heavy Equipment',
  aerial_work_platform: 'Aerial Work Platform',
  manlift_online:       'Manlift Online',
}

// "Other": one free-text training not in the list (manager_plans.training_other)
export const TRAINING_OTHER_MAX = 200

export function isTrainingKey(value: unknown): value is TrainingKey {
  return typeof value === 'string' && (TRAINING_KEYS as readonly string[]).includes(value)
}
