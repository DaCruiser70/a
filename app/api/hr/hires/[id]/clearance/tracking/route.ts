import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { RCMP_RECIPIENTS, rcmpRecipientForOffice, type RcmpRecipientKey } from '@/lib/clearance'
import { loadClearanceRequirements, decryptClearanceField } from '@/lib/clearance-server'
import { loadHrClearanceFull } from '@/lib/clearance-package'
import { loadProjectBlock } from '@/lib/pm-server'
import { projectBlockRows } from '@/lib/pm'
import type { Database } from '@/types'

type TrackingUpsert = Database['public']['Tables']['clearance_tracking']['Insert']

const BodySchema = z.strictObject({
  action:        z.enum(['copy_pspc_details', 'pspc_sent', 'rcmp_sent', 'cleared']),
  rcmpRecipient: z.enum(Object.keys(RCMP_RECIPIENTS) as [RcmpRecipientKey, ...RcmpRecipientKey[]]).optional(),
})

const AUDIT: Record<'pspc_sent' | 'rcmp_sent' | 'cleared', string> = {
  pspc_sent: '<strong>HR</strong> marked the PSPC clearance package as sent',
  rcmp_sent: '<strong>HR</strong> marked the RCMP clearance package as sent',
  cleared:   '<strong>HR</strong> marked the security clearance as cleared',
}

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

// Clearance tracker actions. Nothing is emailed from the portal: HR sends the packages themselves
// and records it here. Marking a step needs an approved clearance form.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:clearance-tracking', user.id), 30, 15 * 60)
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
  const { action, rcmpRecipient } = parsed.data

  const admin = createServiceClient()
  const req = await loadClearanceRequirements(admin, id)
  if (!req.required) return NOT_FOUND()

  const { data: info } = await admin
    .from('clearance_info')
    .select('form_status, submitted_at, legal_name_enc, place_of_birth_enc, dcn_enc')
    .eq('user_id', id)
    .maybeSingle()
  if (!info?.submitted_at) return NextResponse.json({ error: 'The clearance form has not been submitted yet.' }, { status: 409 })

  // ── Copy PSPC email details: project block, legal name, place of birth. Never ID files or the DCN. ──
  if (action === 'copy_pspc_details') {
    if (!req.fingerprint) return NextResponse.json({ error: 'Only PSPC & RCMP clearances have a PSPC package.' }, { status: 409 })
    // Same "Label: value" lines as before, in the order from projectBlockRows; an empty optional
    // field (DCC, Standing Offer) is left out rather than printed with a blank value
    const { block } = await loadProjectBlock(admin, id)
    const text = [
      ...projectBlockRows(block).map(r => `${r.label}: ${r.value ?? ''}`),
      '',
      `Legal name: ${decryptClearanceField(info, 'legal_name_enc') ?? ''}`,
      `Place of birth: ${decryptClearanceField(info, 'place_of_birth_enc') ?? ''}`,
    ].join('\n')

    await admin.from('audit_log').insert({
      user_id: id, action_type: 'amber',
      message: '<strong>HR</strong> copied the PSPC email details',
      performed_by: user.id,
    })
    return NextResponse.json({ text }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // ── Mark a step ──
  if (info.form_status !== 'approved') {
    return NextResponse.json({ error: 'Approve the clearance form before recording the packages.' }, { status: 409 })
  }
  if (action === 'pspc_sent' && !req.fingerprint) {
    return NextResponse.json({ error: 'Only PSPC & RCMP clearances have a PSPC package.' }, { status: 409 })
  }

  const { data: existing } = await admin.from('clearance_tracking').select('*').eq('newhire_id', id).maybeSingle()
  const already =
    (action === 'pspc_sent' && existing?.pspc_sent_at) ||
    (action === 'rcmp_sent' && existing?.rcmp_sent_at) ||
    (action === 'cleared'   && existing?.cleared_at)
  if (already) return NextResponse.json({ ok: true, view: await loadHrClearanceFull(admin, id) })

  const now = new Date().toISOString()
  const row: TrackingUpsert = { newhire_id: id, updated_at: now }
  if (action === 'pspc_sent') { row.pspc_sent_at = now; row.pspc_sent_by = user.id }
  if (action === 'cleared')   { row.cleared_at   = now; row.cleared_by   = user.id }
  if (action === 'rcmp_sent') {
    const { data: profile } = await admin.from('profiles').select('office_location').eq('id', id).maybeSingle()
    // Office decides the recipient; a Remote hire needs HR's choice
    const key = rcmpRecipientForOffice(profile?.office_location) ?? rcmpRecipient
    if (!key) return NextResponse.json({ error: 'Choose who the RCMP package goes to.' }, { status: 400 })
    row.rcmp_sent_at   = now
    row.rcmp_sent_by   = user.id
    row.rcmp_recipient = RCMP_RECIPIENTS[key].email
  }

  const { error } = await admin.from('clearance_tracking').upsert(row, { onConflict: 'newhire_id' })
  if (error) {
    console.error(`clearance_tracking upsert failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }

  await admin.from('audit_log').insert({
    user_id: id, action_type: 'green', message: AUDIT[action], performed_by: user.id,
  })

  return NextResponse.json({ ok: true, view: await loadHrClearanceFull(admin, id) })
}
