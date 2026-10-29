import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { esc } from '@/lib/safe-html'
import { loadClearanceRequirements } from '@/lib/clearance-server'

const BodySchema = z.strictObject({ sent: z.boolean() })

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

// RCMP-only clearance: HR ticks "Sent to BGIS" once the approved RCMP form has gone to BGIS.
// Records who and when (unticking clears them). Nothing else happens.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:clearance-bgis', user.id), 30, 15 * 60)
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
  const { sent } = parsed.data

  const admin = createServiceClient()
  const req = await loadClearanceRequirements(admin, id)
  if (req.type !== 'rcmp') return NOT_FOUND()

  const { data: info } = await admin.from('clearance_info').select('rcmp_review').eq('user_id', id).maybeSingle()
  if (sent && info?.rcmp_review !== 'approved') {
    return NextResponse.json({ error: 'Approve the RCMP form before marking it sent to BGIS.' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { error } = await admin.from('clearance_tracking').upsert({
    newhire_id:      id,
    sent_to_bgis:    sent,
    sent_to_bgis_at: sent ? now : null,
    sent_to_bgis_by: sent ? user.id : null,
    updated_at:      now,
  }, { onConflict: 'newhire_id' })
  if (error) {
    console.error(`[hr/clearance-bgis] update failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }

  const { data: caller } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  sent ? 'green' : 'amber',
    message:      `<strong>${esc(caller?.full_name ?? 'HR')}</strong> ${sent ? 'marked the RCMP clearance form as sent to BGIS' : 'cleared the RCMP clearance “Sent to BGIS” mark'}`,
    performed_by: user.id,
  })
  return NextResponse.json({ ok: true, sent })
}
