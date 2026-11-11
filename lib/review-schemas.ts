// Request bodies for HR and payroll review actions (flag/approve a form, approve/reject a document,
// add a note). Limits come from lib/field-limits.ts. Server only (zod).

import { z } from 'zod'
import { FIELD_LIMITS } from '@/lib/field-limits'
import { zText, zOptionalText } from '@/lib/field-validation'

export const FORM_STATUSES = ['pending', 'review', 'approved', 'flagged'] as const

// Flag / approve one form. The comment is required when flagging (it tells the hire what to fix).
export const FormStatusBody = z.strictObject({
  formId: z.enum(['personal', 'banking', 'sin', 'policy', 'clearance'], { error: 'Unknown form.' }),
  status: z.enum(FORM_STATUSES, { error: 'Unknown status.' }),
  reason: zOptionalText('Comment', FIELD_LIMITS.note, { multiline: true }),
}).superRefine((v, ctx) => {
  if (v.status === 'flagged' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Add a comment so the hire knows what to fix.' })
})

// Approve or reject one uploaded document. A reason is required to reject.
export const DocumentReviewBody = z.strictObject({
  documentId: z.uuid({ error: 'Unknown document.' }),
  action:     z.enum(['approve', 'reject'], { error: 'Invalid action.' }),
  reason:     zOptionalText('Reason', FIELD_LIMITS.note, { multiline: true }),
}).superRefine((v, ctx) => {
  if (v.action === 'reject' && !v.reason) ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Add a reason for the rejection.' })
})

export const NoteBody = z.strictObject({
  noteText: zText('Note', FIELD_LIMITS.note, { multiline: true }),
})

// Route ids: a malformed one is the same 404 as an unknown one
export const isUuid = (v: string) => z.uuid().safeParse(v).success
