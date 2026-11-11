// Every field length limit and format rule, in ONE place. Used by the server's zod validation
// (lib/field-validation.ts) and by the forms (maxLength, inputMode, pattern hints). Change a number
// here and both sides follow. No server imports and no zod, so forms can import it cheaply.

export const FIELD_LIMITS = {
  personName:     60,    // first, last, preferred, emergency contact
  legalName:      100,   // clearance: full legal name (several given names can exceed 60)
  address:        100,   // address lines
  city:           60,
  placeOfBirth:   100,
  relationship:   40,
  email:          254,
  phoneInput:     20,    // raw input while typing, with spaces, dashes, brackets, +1
  phoneDigits:    10,    // stored, after normalising
  signature:      100,   // typed signature / acknowledgement name
  shortText:      120,   // labels, titles, job position, bank and document labels
  position:       100,
  employeeId:     50,
  note:           1000,  // HR notes, flag and rejection comments, stakeholder notes
  longText:       2000,  // longer explanation boxes
  search:         100,
  password:       128,   // never trimmed or changed
  fileName:       120,   // shown to people; longer names are shortened, keeping the extension
  sinDigits:      9,
  institutionDigits: 3,
  transitDigits:  5,
  accountMinDigits: 7,
  accountMaxDigits: 12,
  dobMinAge:      14,
  dobMaxAge:      100,
} as const

// Request bodies: JSON larger than this is refused before it is parsed (413)
export const JSON_BODY_MAX_BYTES = 16 * 1024
// The middleware's backstop for every mutating /api request (some routes carry longer plans)
export const API_BODY_MAX_BYTES  = 64 * 1024

// Uploads (documents and the void cheque): already 10 MB and PDF/JPG/PNG in the forms; now the
// same is checked on the server
export const UPLOAD_MAX_BYTES = 10 * 1024 * 1024
export const UPLOAD_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'] as const

// Provinces and territories: a fixed list, never free text
export const PROVINCES_AND_TERRITORIES = [
  'Ontario', 'British Columbia', 'Alberta', 'Quebec', 'Nova Scotia', 'New Brunswick',
  'Manitoba', 'Saskatchewan', 'Newfoundland and Labrador', 'Prince Edward Island',
  'Yukon', 'Northwest Territories', 'Nunavut',
] as const

export const BANK_NAMES = [
  'Royal Bank of Canada (RBC)', 'Toronto-Dominion Bank (TD)', 'Bank of Nova Scotia (Scotiabank)',
  'Bank of Montreal (BMO)', 'Canadian Imperial Bank of Commerce (CIBC)', 'National Bank of Canada',
  'HSBC Canada', 'Desjardins', 'Other',
] as const
export const ACCOUNT_TYPES = ['Chequing', 'Savings'] as const

// ── Cleaning: NFC, no control or zero-width characters, trimmed, repeated spaces collapsed ──

// Control characters (tab, newline and carriage return are handled by the cleaners) and
// zero-width / direction-override characters that hide or disguise text
const CONTROL    = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/
const INVISIBLE  = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/

export function hasForbiddenChars(value: string): boolean {
  return CONTROL.test(value) || INVISIBLE.test(value)
}

// One line: newlines and tabs become spaces, repeated spaces collapse, trimmed
export function cleanLine(value: string): string {
  return value.normalize('NFC').replace(/[\t\r\n]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

// Notes and comments: line breaks kept (at most one blank line in a row), spaces collapsed per line
export function cleanMultiline(value: string): string {
  return value.normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .split('\n').map(l => l.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Names: letters (any language, with accents), spaces, hyphens, apostrophes and periods ──

export const NAME_PATTERN = /^\p{L}[\p{L}\p{M} .'’-]*$/u
export const NAME_PATTERN_HTML = "[\\p{L}][\\p{L}\\p{M} .'’\\-]*"   // for the pattern attribute (v flag)

// ── Phone: digits only, exactly 10 for North America, a leading +1 or 1 removed ──

export function normalizePhone(raw: string): string | null {
  const v = raw.trim()
  if (!v || v.length > FIELD_LIMITS.phoneInput) return null
  if (!/^\+?[\d\s().-]+$/.test(v)) return null           // letters and anything else: rejected
  let digits = v.replace(/\D/g, '')
  if (v.startsWith('+')) {
    if (!digits.startsWith('1')) return null              // North American numbers only
    digits = digits.slice(1)
  } else if (digits.length === 11 && digits.startsWith('1')) {
    digits = digits.slice(1)
  }
  // Area code and exchange both start with 2–9 (North American numbering plan)
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? digits : null
}

// For display: stored digits as (905) 555-0100; anything else (older saved values) unchanged
export function formatPhone(value: string | null | undefined): string {
  if (!value) return ''
  return /^\d{10}$/.test(value) ? `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6)}` : value
}

// ── Canadian postal code: A1A 1A1, upper case ──

const POSTAL = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/
export function normalizePostalCode(raw: string): string | null {
  const v = raw.trim().toUpperCase().replace(/\s+/g, '')
  return POSTAL.test(v) ? `${v.slice(0, 3)} ${v.slice(3)}` : null
}

// ── SIN: 9 digits (spaces and dashes allowed while typing) with the standard checksum ──

export function normalizeSin(raw: string): string | null {
  const v = raw.trim()
  if (!/^[\d\s-]+$/.test(v)) return null
  const digits = v.replace(/[\s-]/g, '')
  return /^\d{9}$/.test(digits) && sinChecksumValid(digits) ? digits : null
}

// Luhn (mod 10), as used for Canadian SINs. 000 000 000 is never valid.
export function sinChecksumValid(digits: string): boolean {
  if (!/^\d{9}$/.test(digits) || /^0+$/.test(digits)) return false
  let sum = 0
  for (let i = 0; i < 9; i++) {
    let d = Number(digits[i])
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9 }
    sum += d
  }
  return sum % 10 === 0
}

// ── Banking numbers: digits only ──

export function digitsOnly(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

// ── Date of birth: a real date, not in the future, age 14 to 100 ──

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function yearsBefore(today: Date, years: number): Date {
  const y = today.getFullYear() - years
  const lastDay = new Date(y, today.getMonth() + 1, 0).getDate()   // 29 Feb → 28 Feb
  return new Date(y, today.getMonth(), Math.min(today.getDate(), lastDay))
}

// The latest and earliest allowed dates of birth, as YYYY-MM-DD (for the date input's max and min)
export function dobLatest(today: Date = new Date()): string { return ymd(yearsBefore(today, FIELD_LIMITS.dobMinAge)) }
export function dobEarliest(today: Date = new Date()): string { return ymd(yearsBefore(today, FIELD_LIMITS.dobMaxAge)) }

export function dobError(value: string, today: Date = new Date()): string | null {
  const v = value.trim()
  if (!v) return 'Enter your date of birth.'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return 'Enter a valid date of birth.'
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return 'Enter a valid date of birth.'
  if (v > ymd(today)) return 'Date of birth cannot be in the future.'
  if (v > dobLatest(today)) return `You must be at least ${FIELD_LIMITS.dobMinAge} years old.`
  if (v < dobEarliest(today)) return 'Enter a valid date of birth.'
  return null
}

// ── File names: shown as plain text, at most 120 characters, extension kept ──

export function displayFileName(raw: unknown, fallback = 'file'): string {
  if (typeof raw !== 'string') return fallback
  const clean = cleanLine(raw).replace(INVISIBLE, '').replace(/[/\\]/g, '_')
    const name = clean.replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
  if (!name) return fallback
  if (name.length <= FIELD_LIMITS.fileName) return name
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : ''
  return name.slice(0, FIELD_LIMITS.fileName - ext.length - 1).trimEnd() + '…' + ext
}

// ── Input hints for the forms (the server is the real check) ──

export const INPUT_HINTS = {
  personName: { maxLength: FIELD_LIMITS.personName, autoComplete: 'name' },
  phone:      { maxLength: FIELD_LIMITS.phoneInput, inputMode: 'tel' as const, type: 'tel', pattern: '[0-9 ()+.\\-]*' },
  postalCode: { maxLength: 7, pattern: '[A-Za-z][0-9][A-Za-z] ?[0-9][A-Za-z][0-9]', autoComplete: 'postal-code' },
  sin:        { maxLength: 11, inputMode: 'numeric' as const, pattern: '[0-9 \\-]*' },
  institution:{ maxLength: FIELD_LIMITS.institutionDigits, inputMode: 'numeric' as const, pattern: '[0-9]{3}' },
  transit:    { maxLength: FIELD_LIMITS.transitDigits, inputMode: 'numeric' as const, pattern: '[0-9]{5}' },
  account:    { maxLength: FIELD_LIMITS.accountMaxDigits, inputMode: 'numeric' as const, pattern: '[0-9]{7,12}' },
  email:      { maxLength: FIELD_LIMITS.email, inputMode: 'email' as const, type: 'email' },
} as const
