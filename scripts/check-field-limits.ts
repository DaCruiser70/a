// Read-only: how many EXISTING saved values would fail the new field rules (lib/field-limits.ts).
// Covers the encrypted fields, which SQL cannot check: values are decrypted in memory only, never
// printed, logged or written. Prints counts only. Nothing is changed.
//
// Usage (from the project root):
//   npx tsx --env-file=.env.local scripts/check-field-limits.ts

import { createServiceClient } from '../lib/supabase/server'
import { decrypt, decryptFields, isEncrypted } from '../lib/encrypt'
import {
  FIELD_LIMITS, NAME_PATTERN, PROVINCES_AND_TERRITORIES, BANK_NAMES, ACCOUNT_TYPES,
  normalizePhone, normalizePostalCode, normalizeSin, dobError, hasForbiddenChars,
} from '../lib/field-limits'

const counts = new Map<string, { checked: number; failing: number }>()
function tally(label: string, value: string | null | undefined, fails: (v: string) => boolean) {
  if (value === null || value === undefined || value === '') return
  const c = counts.get(label) ?? { checked: 0, failing: 0 }
  c.checked++
  if (fails(value)) c.failing++
  counts.set(label, c)
}
const tooLong = (max: number) => (v: string) => v.length > max || hasForbiddenChars(v)
const badName = (max: number) => (v: string) => v.trim().length > max || !NAME_PATTERN.test(v.trim().normalize('NFC'))
const dec = (v: string | null | undefined) => {
  if (!isEncrypted(v)) return null
  try { return decrypt(v) } catch { return null }
}

async function main() {
  const admin = createServiceClient()

  const { data: personal } = await admin.from('personal_info').select('*')
  for (const raw of personal ?? []) {
    const p = decryptFields(raw) as Record<string, string | null>
    tally('personal: first name', p.first_name, badName(FIELD_LIMITS.personName))
    tally('personal: last name', p.last_name, badName(FIELD_LIMITS.personName))
    tally('personal: date of birth', p.date_of_birth, v => dobError(v) !== null)
    tally('personal: phone', p.phone, v => !normalizePhone(v))
    tally('personal: personal phone', p.personal_phone, v => !normalizePhone(v))
    tally('personal: emergency phone', p.emergency_phone, v => !normalizePhone(v))
    tally('personal: emergency contact name', p.emergency_name, badName(FIELD_LIMITS.personName))
    tally('personal: street', p.street, tooLong(FIELD_LIMITS.address))
    tally('personal: city', p.city, tooLong(FIELD_LIMITS.city))
    tally('personal: postal code', p.postal_code, v => !normalizePostalCode(v))
    tally('personal: province', p.province, v => !(PROVINCES_AND_TERRITORIES as readonly string[]).includes(v))
    tally('personal: email', p.personal_email, v => v.length > FIELD_LIMITS.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
  }

  const { data: banking } = await admin.from('banking_info').select('bank_name, account_type, institution_number_enc, transit_number_enc, account_number_enc, void_cheque_name')
  for (const b of banking ?? []) {
    tally('banking: bank name', b.bank_name, v => !(BANK_NAMES as readonly string[]).includes(v))
    tally('banking: account type', b.account_type, v => !(ACCOUNT_TYPES as readonly string[]).includes(v))
    tally('banking: institution number', dec(b.institution_number_enc), v => !/^\d{3}$/.test(v.replace(/[\s-]/g, '')))
    tally('banking: transit number', dec(b.transit_number_enc), v => !/^\d{5}$/.test(v.replace(/[\s-]/g, '')))
    tally('banking: account number', dec(b.account_number_enc), v => !/^\d{7,12}$/.test(v.replace(/[\s-]/g, '')))
    tally('banking: void cheque file name', b.void_cheque_name, tooLong(FIELD_LIMITS.fileName))
  }

  const { data: sins } = await admin.from('sin_info').select('sin_enc')
  for (const s of sins ?? []) tally('SIN: 9 digits with a valid checksum', dec(s.sin_enc), v => !normalizeSin(v))

  const { data: clearance } = await admin.from('clearance_info').select('legal_name_enc, place_of_birth_enc')
  for (const c of clearance ?? []) {
    tally('clearance: full legal name', dec(c.legal_name_enc), badName(FIELD_LIMITS.legalName))
    tally('clearance: place of birth', dec(c.place_of_birth_enc), tooLong(FIELD_LIMITS.placeOfBirth))
  }

  const { data: tasks } = await admin.from('stakeholder_tasks').select('completion_note_enc')
  for (const t of tasks ?? []) tally('stakeholder: completion note', dec(t.completion_note_enc), tooLong(FIELD_LIMITS.note))

  console.log('Existing values that would fail the new rules (counts only; writes only are enforced):')
  for (const [label, c] of [...counts.entries()].sort()) {
    console.log(`  ${label.padEnd(40)} ${String(c.failing).padStart(4)} of ${c.checked}`)
  }
}

main().catch(() => { console.log('check failed'); process.exitCode = 1 })
