import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { esc } from '@/lib/safe-html'
import { REGIONS } from '@/lib/regions'
import { syncPmRequest } from '@/lib/pm-server'

const BodySchema = z.strictObject({
  region: z.enum(REGIONS),
})

// HR sets or changes a hire's region (separate from the office). The project-management request
// follows: an open or claimed request moves to the new region's team; a done request never changes.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:hire-region', user.id), 30, 15 * 60)
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
  if (!parsed.success) return NextResponse.json({ error: 'Please choose a region from the list.' }, { status: 400 })
  const { region } = parsed.data

  const admin = createServiceClient()
  const { data: hire } = await admin
    .from('profiles')
    .select('id, region')
    .eq('id', id)
    .eq('role', 'newhire')
    .maybeSingle()
  if (!hire) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (hire.region !== region) {
    const { error } = await admin
      .from('profiles')
      .update({ region, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      console.error(`[hr/hire-region] update failed (code ${error.code})`)
      return NextResponse.json({ error: 'Could not save the region. Please try again.' }, { status: 500 })
    }

    const { data: caller } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    await admin.from('audit_log').insert({
      user_id:      id,
      action_type:  'navy',
      message:      hire.region
        ? `<strong>${esc(caller?.full_name ?? 'HR')}</strong> changed the region from ${esc(hire.region)} to ${esc(region)}`
        : `<strong>${esc(caller?.full_name ?? 'HR')}</strong> set the region to ${esc(region)}`,
      performed_by: user.id,
    })
  }

  // Runs on every save so a missing request is created even when the region was already right
  const pm = await syncPmRequest(admin, id)

  return NextResponse.json({ ok: true, region, pm })
}
