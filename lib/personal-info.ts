// Personal Information form rules, shared by the form page and POST /api/forms/personal.
// No server imports. Lengths and formats come from lib/field-limits.ts (the one place they live).

import { PHONE_ERROR } from '@/lib/phone-format'
import {
  FIELD_LIMITS, PROVINCES_AND_TERRITORIES, normalizePhone, dobError as dobRule, dobLatest as latest, dobEarliest,
} from '@/lib/field-limits'

// Provinces and territories (a fixed list)
export const PROVINCES = PROVINCES_AND_TERRITORIES

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
// 10 digits for North America; spaces, dashes, brackets and a leading +1 are fine while typing.
export const PHONE_MAX = FIELD_LIMITS.phoneInput

export function phoneError(value: string): string | null {
  return value.trim() && normalizePhone(value) ? null : PHONE_ERROR
}

// ── Date of birth: a real date, not in the future, age 14 to 100 ──
export const DOB_MIN_AGE = FIELD_LIMITS.dobMinAge
export const dobLatest   = latest
export const dobEarliestDate = dobEarliest
export const dobError    = dobRule

// "1990-05-14" → "May 14, 1990" (no time zone shift)
export function formatDob(value: string | null | undefined): string | null {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!m) return value ?? null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    .toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })
}
