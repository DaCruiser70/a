// Phone numbers while typing, shared by every phone field (components/ui/PhoneInput.tsx). No server
// imports. The server rule is unchanged and stays the real check: lib/field-limits.ts normalizePhone
// (10 digits after removing spaces, dashes, brackets and +1; letters refused; stored as digits).

import { FIELD_LIMITS } from '@/lib/field-limits'

export const PHONE_PLACEHOLDER = '(905) 555-0100'
export const PHONE_HINT        = '10 digits, no country code needed.'
export const PHONE_PREFIX_SR   = 'Country code plus one is already included.'   // read by screen readers
export const PHONE_ERROR       = 'Enter a 10-digit phone number, like (905) 555-0100.'
export const PHONE_INPUT_MAX   = FIELD_LIMITS.phoneInput   // room to paste "+1 (905) 555-0100"

// The national digits typed so far: a typed or pasted +1, or a leading 1, is the country code and is
// dropped (North American area codes never start with 1). At most 10 digits are kept.
export function phoneDigitsFromInput(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('1')) digits = digits.slice(1)
  return digits.slice(0, FIELD_LIMITS.phoneDigits)
}

// Formats as the person types: "(905", "(905) 555", "(905) 555-0100". Partial input stays editable:
// three digits show without the closing bracket, so Backspace removes a digit, not a bracket.
export function formatPhoneInput(raw: string): string {
  const d = phoneDigitsFromInput(raw)
  if (d.length === 0) return ''
  if (d.length <= 3) return `(${d}`
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}
