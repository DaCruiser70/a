// The documents a hire must have approved for the "Documents" item (one of the 5 onboarding items).
// The ONLY place the required slots are defined. No server imports.
//
// A slot is satisfied when ANY of its accepted document types is approved: the ID slot accepts a
// Driver's License or an Alternative ID (passport or other government photo ID); one is enough.
// Exception: a hire assigned a Company Vehicle must have the Driver's License (insurance needs it),
// so for them the ID slot accepts the Driver's License only (requiredDocumentSlots below).
// Every other document type is optional and never affects progress or status.

export type RequiredDocumentSlot = {
  key:     string
  label:   string              // used in "Waiting on hire: …"
  short:   string              // compact label
  types:   readonly string[]   // newhire_documents.document_type values that satisfy the slot
}

export const REQUIRED_DOCUMENT_SLOTS = [
  { key: 'td1_federal',    label: 'TD1 Federal Tax Form',                          short: 'TD1 Federal',    types: ['td1_federal'] },
  { key: 'td1_provincial', label: 'TD1 Provincial Tax Form',                       short: 'TD1 Provincial', types: ['td1_provincial'] },
  { key: 'id',             label: 'an ID (Driver’s License or Alternative ID)',    short: 'ID',             types: ['drivers_license', 'alternative_id'] },
] as const satisfies readonly RequiredDocumentSlot[]

export type RequiredSlotKey = typeof REQUIRED_DOCUMENT_SLOTS[number]['key']

// The accepted ID types (used by the clearance package too, which needs an ID on file)
export const ID_DOCUMENT_TYPES = REQUIRED_DOCUMENT_SLOTS.find(s => s.key === 'id')!.types

export const DRIVERS_LICENSE_TYPE = 'drivers_license'

// What changes the required slots for one hire
export type DocumentRequirements = { companyVehicle?: boolean }

// The ID slot for a company-vehicle hire: the Driver's License only
const VEHICLE_ID_SLOT: RequiredDocumentSlot = {
  key:   'id',
  label: 'Driver’s License (required for company vehicle)',
  short: 'Driver’s License',
  types: [DRIVERS_LICENSE_TYPE],
}

// The required slots for one hire. The same three slots for everyone; only what satisfies the ID
// slot differs. Without a company vehicle this is exactly REQUIRED_DOCUMENT_SLOTS.
export function requiredDocumentSlots(req: DocumentRequirements = {}): readonly RequiredDocumentSlot[] {
  return req.companyVehicle
    ? REQUIRED_DOCUMENT_SLOTS.map(s => (s.key === 'id' ? VEHICLE_ID_SLOT : s))
    : REQUIRED_DOCUMENT_SLOTS
}

export function slotForType(documentType: string) {
  return REQUIRED_DOCUMENT_SLOTS.find(s => (s.types as readonly string[]).includes(documentType)) ?? null
}
