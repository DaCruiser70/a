// Server-side field validation built from lib/field-limits.ts. Every builder cleans the value (NFC,
// trimmed, repeated spaces collapsed), rejects control and zero-width characters, and fails with a
// friendly, field-specific message. Messages never contain the submitted value.

import { z } from 'zod'
import { PHONE_ERROR } from '@/lib/phone-format'
import {
  FIELD_LIMITS, JSON_BODY_MAX_BYTES, NAME_PATTERN, PROVINCES_AND_TERRITORIES,
  cleanLine, cleanMultiline, hasForbiddenChars, normalizePhone, normalizePostalCode, normalizeSin,
  digitsOnly, dobError,
} from '@/lib/field-limits'

// Raw strings are capped generously before cleaning so huge inputs are refused early
const raw = (max: number) => z.string().max(Math.max(max * 2, 64))

type TextOptions = { multiline?: boolean; pattern?: RegExp; patternMessage?: string }

function text(label: string, max: number, opts: TextOptions, required: boolean) {
  return raw(max).nullable().optional().transform((value, ctx) => {
    const v = typeof value === 'string' ? value : ''
    if (hasForbiddenChars(v)) {
      ctx.addIssue({ code: 'custom', message: `${label} contains characters that are not allowed.` })
      return z.NEVER
    }
    const clean = opts.multiline ? cleanMultiline(v) : cleanLine(v)
    if (!clean) {
      if (required) { ctx.addIssue({ code: 'custom', message: `${label} is required.` }); return z.NEVER }
      return null
    }
    if (clean.length > max) {
      ctx.addIssue({ code: 'custom', message: `${label} must be ${max} characters or fewer.` })
      return z.NEVER
    }
    if (opts.pattern && !opts.pattern.test(clean)) {
      ctx.addIssue({ code: 'custom', message: opts.patternMessage ?? `${label} is not in the right format.` })
      return z.NEVER
    }
    return clean
  })
}

// Plain text, required
export function zText(label: string, max: number, opts: TextOptions = {}): z.ZodType<string> {
  return text(label, max, opts, true) as unknown as z.ZodType<string>
}

// Plain text, optional: empty (or missing) becomes null
export function zOptionalText(label: string, max: number, opts: TextOptions = {}): z.ZodType<string | null> {
  return text(label, max, opts, false) as unknown as z.ZodType<string | null>
}

// Names: 1–60 letters (accents fine), spaces, hyphens, apostrophes and periods
const nameOpts = (label: string) => ({
  pattern: NAME_PATTERN,
  patternMessage: `${label} can only contain letters, spaces, hyphens, apostrophes and periods.`,
})
export function zName(label: string, max: number = FIELD_LIMITS.personName): z.ZodType<string> {
  return zText(label, max, nameOpts(label))
}
export function zOptionalName(label: string, max: number = FIELD_LIMITS.personName): z.ZodType<string | null> {
  return zOptionalText(label, max, nameOpts(label))
}

export function zEmail(label = 'Email') {
  return zText(label, FIELD_LIMITS.email).transform((v, ctx) => {
    const lower = v.toLowerCase()
    if (!z.email().safeParse(lower).success) {
      ctx.addIssue({ code: 'custom', message: `Enter a valid ${label.toLowerCase()}.` })
      return z.NEVER
    }
    return lower
  })
}

// Optional email: empty becomes null
export function zOptionalEmail(label = 'Email'): z.ZodType<string | null> {
  return zOptionalText(label, FIELD_LIMITS.email).transform((v, ctx) => {
    if (v === null) return null
    const lower = v.toLowerCase()
    if (!z.email().safeParse(lower).success) {
      ctx.addIssue({ code: 'custom', message: `Enter a valid ${label.toLowerCase()}.` })
      return z.NEVER
    }
    return lower
  }) as unknown as z.ZodType<string | null>
}

// Phone: stored as 10 digits. One message for every phone field (lib/phone-format.ts).
export function zPhone() {
  return raw(FIELD_LIMITS.phoneInput).transform((v, ctx) => {
    const digits = hasForbiddenChars(v) ? null : normalizePhone(v)
    if (!digits) {
      ctx.addIssue({ code: 'custom', message: PHONE_ERROR })
      return z.NEVER
    }
    return digits
  })
}

export function zPostalCode(label = 'Postal code') {
  return raw(10).transform((v, ctx) => {
    const code = normalizePostalCode(v)
    if (!code) {
      ctx.addIssue({ code: 'custom', message: `${label} must look like A1A 1A1.` })
      return z.NEVER
    }
    return code
  })
}

export const zProvince = z.enum(PROVINCES_AND_TERRITORIES, { error: 'Choose a province or territory from the list.' })

export function zDateOfBirth() {
  return raw(10).transform((v, ctx) => {
    const error = dobError(v)
    if (error) { ctx.addIssue({ code: 'custom', message: error }); return z.NEVER }
    return v.trim()
  })
}

// SIN: 9 digits with the standard checksum. The message never includes the value.
export function zSin() {
  return raw(11).transform((v, ctx) => {
    const sin = normalizeSin(v)
    if (!sin) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 9-digit Social Insurance Number.' })
      return z.NEVER
    }
    return sin
  })
}

// Digits only (spaces and dashes removed), between min and max digits
export function zDigits(label: string, min: number, max: number = min) {
  return raw(max + 4).transform((v, ctx) => {
    const d = digitsOnly(v.trim())
    if (!/^\d+$/.test(d) || d.length < min || d.length > max) {
      ctx.addIssue({ code: 'custom', message: min === max ? `${label} must be exactly ${min} digits.` : `${label} must be ${min} to ${max} digits.` })
      return z.NEVER
    }
    return d
  })
}

// Passwords: only a length cap; never trimmed or changed. Other rules stay in lib/password-rules.ts.
export const zPassword = z.string().min(1).max(FIELD_LIMITS.password)

export const zIsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date.').refine(v => {
  const [y, m, d] = v.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}, 'Enter a valid date.')

// The first problem as { field, message }: the field name and a friendly message, never the value
export function firstIssue(error: z.ZodError): { field: string | null; message: string } {
  const issue = error.issues[0]
  const field = issue?.path?.length ? String(issue.path[0]) : null
  // Our own messages are written for people; zod's built-in ones (wrong type, unknown key) are not
  const message = issue?.code === 'custom' && issue.message ? issue.message : 'Please check the form and try again.'
  return { field, message }
}

// Reads a JSON body of at most maxBytes. Too large: 413. Not JSON: 400. Never logs the body.
export async function readJsonBody(request: Request, maxBytes: number = JSON_BODY_MAX_BYTES):
  Promise<{ ok: true; data: unknown } | { ok: false; status: 400 | 413 }> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > maxBytes) return { ok: false, status: 413 }
  let text: string
  try { text = await request.text() } catch { return { ok: false, status: 400 } }
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, status: 413 }
  if (!text) return { ok: true, data: null }
  try { return { ok: true, data: JSON.parse(text) } } catch { return { ok: false, status: 400 } }
}

export const BODY_TOO_LARGE = 'That request is too large.'
export const INVALID_REQUEST = 'Invalid request.'
