import { z } from 'zod'

// Company vehicle request: Rob fills the vehicle details, Heather checks and completes them, then
// Marley confirms the vehicle insurance. Shared by the stakeholder screens, the routes and the HR
// view. No server imports.

export const VEHICLE_STEPS = ['rob', 'heather', 'marley', 'complete'] as const
export type VehicleStep = typeof VEHICLE_STEPS[number]
export type VehicleActorStep = Exclude<VehicleStep, 'complete'>

export const VEHICLE_STEP_LABELS: Record<VehicleStep, string> = {
  rob:      'Waiting on Rob',
  heather:  'Waiting on Heather',
  marley:   'Waiting on Marley (insurance)',
  complete: 'Complete',
}

// stakeholder_tasks rows: Rob and Heather share 'vehicle'; Marley's is a separate, clearly named key
export const VEHICLE_TASK_KEY   = 'vehicle'
export const INSURANCE_TASK_KEY = 'vehicle_insurance'
export const VEHICLE_TASK_NAME   = 'Company Vehicle — vehicle details'
export const INSURANCE_TASK_NAME = 'Vehicle insurance — Company Vehicle'
export const VEHICLE_TASK_KEYS: readonly string[] = [VEHICLE_TASK_KEY, INSURANCE_TASK_KEY]

// ── Fields ───────────────────────────────────────────────────────────────────
export const VEHICLE_FIELDS = ['make', 'model', 'year', 'vin', 'license_plate', 'unit_number', 'customer_unit_number', 'previous_driver'] as const
export type VehicleField = typeof VEHICLE_FIELDS[number]
export type VehicleDetails = Partial<Record<VehicleField, string>>

export const VEHICLE_FIELD_LABELS: Record<VehicleField, string> = {
  make:                 'Make',
  model:                'Model',
  year:                 'Year',
  vin:                  'VIN',
  license_plate:        'License plate number',
  unit_number:          'Unit number',
  customer_unit_number: 'Customer unit number',
  previous_driver:      'Previous driver',
}

export const VEHICLE_FIELD_MAX: Record<VehicleField, number> = {
  make: 60, model: 60, year: 4, vin: 17, license_plate: 15, unit_number: 30, customer_unit_number: 30, previous_driver: 120,
}

export const VEHICLE_GROUPS: { title: string; fields: VehicleField[]; gasCard?: boolean }[] = [
  { title: 'Vehicle',          fields: ['make', 'model', 'year', 'vin'] },
  { title: 'Identification',   fields: ['license_plate', 'unit_number', 'customer_unit_number'] },
  { title: 'Driver and fuel',  fields: ['previous_driver'], gasCard: true },
]

export const GAS_CARD_LABEL = 'Gas card acquired?'

const nextYear = () => new Date().getFullYear() + 1

// Everything is optional. Trimmed; blank means "not provided".
const text = (f: VehicleField) => z.string().trim().max(VEHICLE_FIELD_MAX[f], `${VEHICLE_FIELD_LABELS[f]}: at most ${VEHICLE_FIELD_MAX[f]} characters.`)
export const VehicleDetailsSchema = z.strictObject({
  make:                 text('make'),
  model:                text('model'),
  year:                 z.string().trim()
                          .refine(v => v === '' || /^\d{4}$/.test(v), 'Year must be 4 digits.')
                          .refine(v => v === '' || (Number(v) >= 1980 && Number(v) <= nextYear()), `Year must be between 1980 and ${nextYear()}.`),
  vin:                  text('vin').refine(v => /^[A-Za-z0-9]*$/.test(v), 'VIN: letters and digits only.'),
  license_plate:        text('license_plate'),
  unit_number:          text('unit_number'),
  customer_unit_number: text('customer_unit_number'),
  previous_driver:      text('previous_driver'),
})

// 'yes' | 'no' | null (not answered)
export const GasCardSchema = z.enum(['yes', 'no']).nullable()

// Drops blanks and normalises the VIN to capitals
export function cleanDetails(d: z.infer<typeof VehicleDetailsSchema>): VehicleDetails {
  const out: VehicleDetails = {}
  for (const f of VEHICLE_FIELDS) {
    const v = d[f].trim()
    if (v) out[f] = f === 'vin' ? v.toUpperCase() : v
  }
  return out
}

export function gasCardText(v: boolean | null | undefined): string {
  return v === true ? 'Yes' : v === false ? 'No' : 'Not answered'
}
