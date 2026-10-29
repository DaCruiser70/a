import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { esc } from '@/lib/safe-html'
import { pmMemberOr401 } from '@/lib/pm-server'
import { PM_DETAIL_FIELDS, PM_DETAIL_LABELS, PmDetailsSchema, missingPmFields, type PmDetails } from '@/lib/pm'

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

// Save the project details on a request. Only the member who claimed it can save, only while it is
// claimed (never once done), and only in the member's own region (from the session). Drafts may
// leave any field empty. The audit entry names the member and which fields changed, never values.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('project_mgmt')
  if (auth instanceof NextResponse) return auth
  const member = pmMemberOr401(auth.member)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = await rateLimit(await rateLimitKey('pm:details', member.id), 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many saves in a short time. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = PmDetailsSchema.safeParse(raw)
  if (!parsed.success) {
    const fields: Partial<Record<keyof PmDetails, string>> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (typeof key === 'string' && (PM_DETAIL_FIELDS as readonly string[]).includes(key) && !fields[key as keyof PmDetails]) {
        fields[key as keyof PmDetails] = issue.message
      }
    }
    return NextResponse.json({ error: 'Some details need attention before they can be saved.', fields }, { status: 400 })
  }
  const next: PmDetails = {
    dcc:              parsed.data.dcc              || null,
    standing_offer:   parsed.data.standing_offer   || null,
    project_name:     parsed.data.project_name     || null,
    project_location: parsed.data.project_location || null,
  }

  const admin = createServiceClient()
  const { data: current } = await admin
    .from('pm_requests')
    .select('status, claimed_by, dcc, standing_offer, project_name, project_location')
    .eq('newhire_id', id)
    .eq('region', member.region)
    .neq('status', 'cancelled')
    .maybeSingle()
  if (!current) return NOT_FOUND()
  if (current.status === 'done') {
    return NextResponse.json({ error: 'This request is done. Its details can no longer be changed.' }, { status: 409 })
  }
  if (current.status !== 'claimed' || current.claimed_by !== member.id) {
    return NextResponse.json({ error: 'Only the person who claimed this request can edit its details.' }, { status: 409 })
  }

  const changed = PM_DETAIL_FIELDS.filter(f => (current[f] ?? null) !== next[f])
  if (changed.length > 0) {
    // Same rule in the WHERE clause, so a release or Mark done in between is never overwritten
    const { data: saved, error } = await admin
      .from('pm_requests')
      .update({ ...next, updated_at: new Date().toISOString() })
      .eq('newhire_id', id)
      .eq('region', member.region)
      .eq('status', 'claimed')
      .eq('claimed_by', member.id)
      .select('newhire_id')
    if (error) {
      console.error(`[pm/details] update failed (code ${error.code})`)
      return NextResponse.json({ error: 'Could not save the details. Please try again.' }, { status: 500 })
    }
    if (!saved || saved.length === 0) {
      return NextResponse.json({ error: 'This request changed while you were editing. Reload and try again.' }, { status: 409 })
    }

    await admin.from('audit_log').insert({
      user_id:      id,
      action_type:  'navy',
      message:      `<strong>${esc(member.member_name)}</strong> (project management) updated the project details: ${changed.map(f => esc(PM_DETAIL_LABELS[f])).join(', ')}`,
      performed_by: auth.user.id,
    })
  }

  return NextResponse.json({ ok: true, details: next, changed: changed.length, missing: missingPmFields(next) })
}
