import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { esc } from '@/lib/safe-html'
import { CLEARANCE_KINDS, packageLocked } from '@/lib/clearance'
import { loadClearanceRequirements } from '@/lib/clearance-server'
import { syncClearancePackage } from '@/lib/clearance-package'
import type { FormStatus } from '@/types'

const BodySchema = z.strictObject({
  kind:   z.enum(CLEARANCE_KINDS),
  action: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(2000).optional(),
})

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
const FORM_LABEL = { rcmp: 'RCMP form', fingerprint: 'PSPC fingerprint form' } as const

// HR approves or rejects one clearance form (RCMP, or the PSPC fingerprint form). The overall
// clearance_info.form_status follows: any rejected → flagged (the hire sees the reasons and
// resubmits), every required form approved → approved, otherwise review. Refused while the
// PSPC & RCMP package is with the clearance reviewer.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:clearance-review', user.id), 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many changes in a short time. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { kind, action } = parsed.data
  const reason = parsed.data.reason ?? ''
  if (action === 'reject' && reason.length < 10) {
    return NextResponse.json({ error: 'Please give a reason (at least 10 characters) so the hire knows what to fix.' }, { status: 400 })
  }

  const admin = createServiceClient()
  const req = await loadClearanceRequirements(admin, id)
  if (!req.required || (kind === 'fingerprint' && !req.fingerprint)) return NOT_FOUND()

  const [{ data: row }, { data: tracking }] = await Promise.all([
    admin.from('clearance_info')
      .select('submitted_at, updated_at, rcmp_path, fingerprint_path, rcmp_review, fingerprint_review, rcmp_reject_reason, fingerprint_reject_reason')
      .eq('user_id', id).maybeSingle(),
    admin.from('clearance_tracking').select('package_stage').eq('newhire_id', id).maybeSingle(),
  ])
  if (!row?.submitted_at || !(kind === 'rcmp' ? row.rcmp_path : row.fingerprint_path)) {
    return NextResponse.json({ error: 'The hire has not submitted this form yet.' }, { status: 409 })
  }
  if (packageLocked(tracking?.package_stage)) {
    return NextResponse.json({ error: 'The package is with the clearance reviewer. The forms can be changed only if they send it back to HR.' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const next = {
    rcmp:        kind === 'rcmp'        ? (action === 'approve' ? 'approved' : 'rejected') : row.rcmp_review,
    fingerprint: kind === 'fingerprint' ? (action === 'approve' ? 'approved' : 'rejected') : row.fingerprint_review,
  } as const
  const reasons = {
    rcmp:        kind === 'rcmp'        ? (action === 'reject' ? reason : null) : row.rcmp_reject_reason,
    fingerprint: kind === 'fingerprint' ? (action === 'reject' ? reason : null) : row.fingerprint_reject_reason,
  }
  const required = req.fingerprint ? (['rcmp', 'fingerprint'] as const) : (['rcmp'] as const)
  const formStatus: FormStatus =
    required.some(k => next[k] === 'rejected') ? 'flagged'
    : required.every(k => next[k] === 'approved') ? 'approved'
    : 'review'
  const flagReason = formStatus === 'flagged'
    ? required.filter(k => next[k] === 'rejected').map(k => `${FORM_LABEL[k]}: ${reasons[k] ?? ''}`).join('\n')
    : null

  // One statement, guarded by updated_at so two HR tabs cannot overwrite each other's decision
  const { data: saved, error } = await admin
    .from('clearance_info')
    .update({
      ...(kind === 'rcmp'
        ? { rcmp_review: next.rcmp, rcmp_reject_reason: reasons.rcmp, rcmp_reviewed_at: now, rcmp_reviewed_by: user.id }
        : { fingerprint_review: next.fingerprint, fingerprint_reject_reason: reasons.fingerprint, fingerprint_reviewed_at: now, fingerprint_reviewed_by: user.id }),
      form_status: formStatus,
      flag_reason: flagReason,
      updated_at:  now,
    })
    .eq('user_id', id)
    .eq('updated_at', row.updated_at)
    .select('id')
  if (error) {
    console.error(`[hr/clearance-review] update failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }
  if (!saved || saved.length === 0) {
    return NextResponse.json({ error: 'This form changed while you were looking at it. Reload and try again.' }, { status: 409 })
  }

  const { data: caller } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  action === 'approve' ? 'green' : 'red',
    message:      `<strong>${esc(caller?.full_name ?? 'HR')}</strong> ${action === 'approve' ? 'approved' : 'rejected'} the clearance ${FORM_LABEL[kind]}${action === 'reject' ? ` — ${esc(reason)}` : ''}`,
    performed_by: user.id,
  })

  await syncClearancePackage(admin, id, user.id)
  return NextResponse.json({ ok: true, formStatus })
}
