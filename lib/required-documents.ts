// The documents a hire must have approved for the "Documents" item (one of the 5 onboarding items).
// The ONLY place the required slots are defined. No server imports.
//
// A slot is satisfied when ANY of its accepted document types is approved: the ID slot accepts a
// Driver's License or an Alternative ID (passport or other government photo ID); one is enough.
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

export function slotForType(documentType: string) {
  return REQUIRED_DOCUMENT_SLOTS.find(s => (s.types as readonly string[]).includes(documentType)) ?? null
}
