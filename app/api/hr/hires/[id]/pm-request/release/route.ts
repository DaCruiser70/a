import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'

const BodySchema = z.strictObject({})

// HR can release any claim, putting the request back in its region's Open list.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:pm-release', user.id), 30, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many changes in a short time. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let raw: unknown
  try { raw = await request.json() } catch { raw = {} }
  if (!BodySchema.safeParse(raw ?? {}).success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const admin = createServiceClient()
  const { data: changed, error } = await admin
    .from('pm_requests')
    .update({ status: 'open', claimed_by: null, claimed_at: null, updated_at: new Date().toISOString() })
    .eq('newhire_id', id)
    .eq('status', 'claimed')
    .select('newhire_id')
  if (error) {
    console.error(`[hr/pm-release] update failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not release the claim. Please try again.' }, { status: 500 })
  }
  if (!changed || changed.length === 0) return NextResponse.json({ error: 'There is no claim to release.' }, { status: 409 })

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      '<strong>HR</strong> released the project management claim',
    performed_by: user.id,
  })

  return NextResponse.json({ ok: true })
}
