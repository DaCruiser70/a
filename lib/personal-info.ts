// Personal Information form rules, shared by the form page and POST /api/forms/personal.
// No server imports.

export const PROVINCES = [
  'Ontario', 'British Columbia', 'Alberta', 'Quebec', 'Nova Scotia', 'New Brunswick',
  'Manitoba', 'Saskatchewan', 'Newfoundland and Labrador', 'Prince Edward Island',
] as const

export const EMERGENCY_RELATIONSHIPS = ['Spouse / Partner', 'Parent', 'Sibling', 'Child', 'Friend', 'Other'] as const

// ── Phone setup: a company work phone, or the hire's personal phone ──
export const PHONE_CHOICES = ['work', 'personal'] as const
export type PhoneChoice = typeof PHONE_CHOICES[number]
export const PHONE_CHOICE_LABELS: Record<PhoneChoice, string> = {
  work:     'Company work phone',
  personal: 'My personal phone',
}

export const WORK_PHONE_PLATFORMS = ['apple', 'android'] as const
export type WorkPhonePlatform = typeof WORK_PHONE_PLATFORMS[number]
export const WORK_PHONE_PLATFORM_LABELS: Record<WorkPhonePlatform, string> = {
  apple:   'Apple',
  android: 'Android',
}

// ── Phone numbers (Phone, the personal phone and the emergency phone share one rule) ──
export const PHONE_MAX = 30
const PHONE_CHARS = /^\+?[0-9\s().-]+(?:\s*(?:ext\.?|x)\s*[0-9]{1,6})?$/i

export function phoneError(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Enter a phone number.'
  if (v.length > PHONE_MAX || !PHONE_CHARS.test(v)) return 'Enter a valid phone number, for example (905) 555-0100.'
  const digits = v.replace(/(?:ext\.?|x)\s*[0-9]+$/i, '').replace(/\D/g, '').length
  if (digits < 10 || digits > 15) return 'Enter a valid phone number, for example (905) 555-0100.'
  return null
}

// ── Date of birth: a real date in the past, at least 16 years ago, not before 1900 ──
export const DOB_MIN_AGE  = 16
export const DOB_EARLIEST = '1900-01-01'

const pad = (n: number) => String(n).padStart(2, '0')

// The latest allowed date of birth (today minus 16 years), as YYYY-MM-DD in local time
export function dobLatest(today: Date = new Date()): string {
  const y = today.getFullYear() - DOB_MIN_AGE
  const m = today.getMonth() + 1
  // 29 February → 28 February in a non-leap year
  const lastDay = new Date(y, m, 0).getDate()
  return `${y}-${pad(m)}-${pad(Math.min(today.getDate(), lastDay))}`
}

export function dobError(value: string, today: Date = new Date()): string | null {
  const v = value.trim()
  if (!v) return 'Enter your date of birth.'
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return 'Enter a valid date of birth.'
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return 'Enter a valid date of birth.'
  if (v < DOB_EARLIEST) return 'Enter a valid date of birth.'
  if (v > dobLatest(today)) return `You must be at least ${DOB_MIN_AGE} years old.`
  return null
}

// "1990-05-14" → "May 14, 1990" (no time zone shift)
export function formatDob(value: string | null | undefined): string | null {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!m) return value ?? null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
}
