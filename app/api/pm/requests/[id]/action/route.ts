import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { esc } from '@/lib/safe-html'
import { pmMemberOr401, queuePmDone } from '@/lib/pm-server'

const BodySchema = z.strictObject({ action: z.enum(['claim', 'release', 'done']) })
type Action = z.infer<typeof BodySchema>['action']

const MESSAGES: Record<Action, string> = {
  claim:   'claimed the project management request',
  release: 'released the project management request',
  done:    'marked the project management request as done',
}

const CONFLICT: Record<Action, string> = {
  claim:   'Someone else has already claimed this request.',
  release: 'Only the person who claimed this request can release it.',
  done:    'Only the person who claimed this request can mark it done.',
}

// Claim, release or complete a request. Each is one conditional UPDATE scoped to the member's
// region, so two people can never claim the same request, and only the claimer can release or
// complete it. Every action is audited with the member's name.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('project_mgmt')
  if (auth instanceof NextResponse) return auth
  const member = pmMemberOr401(auth.member)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = await rateLimit(await rateLimitKey('pm:action', member.id), 60, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many changes in a short time. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { action } = parsed.data

  const admin = createServiceClient()
  const now   = new Date().toISOString()
  const table = admin.from('pm_requests')

  // The WHERE clause is the whole rule: region from the session, current status, and the claimer
  const update =
    action === 'claim'
      ? table.update({ status: 'claimed', claimed_by: member.id, claimed_at: now, updated_at: now })
          .eq('newhire_id', id).eq('region', member.region).eq('status', 'open')
      : action === 'release'
        ? table.update({ status: 'open', claimed_by: null, claimed_at: null, updated_at: now })
            .eq('newhire_id', id).eq('region', member.region).eq('status', 'claimed').eq('claimed_by', member.id)
        : table.update({ status: 'done', completed_by: member.id, completed_at: now, updated_at: now })
            .eq('newhire_id', id).eq('region', member.region).eq('status', 'claimed').eq('claimed_by', member.id)

  const { data: changed, error } = await update.select('newhire_id')
  if (error) {
    console.error(`[pm/action] update failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }
  if (!changed || changed.length === 0) {
    // Another region, unknown or cancelled → 404; otherwise it's in the wrong state for this member
    const { data: visible } = await admin.from('pm_requests').select('newhire_id')
      .eq('newhire_id', id).eq('region', member.region).neq('status', 'cancelled').maybeSingle()
    if (!visible) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ error: CONFLICT[action] }, { status: 409 })
  }

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  action === 'done' ? 'green' : 'navy',
    message:      `<strong>${esc(member.member_name)}</strong> (project management) ${MESSAGES[action]}`,
    performed_by: auth.user.id,
  })

  if (action === 'done') await queuePmDone(admin, id)

  return NextResponse.json({ ok: true })
}
