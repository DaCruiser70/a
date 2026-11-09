import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { hasCompanyVehicle, recomputeProfileStatus } from '@/lib/hire-status'
import { cancelVehicleRequest } from '@/lib/vehicle-server'
import { queueHireApproved } from '@/lib/notify'

// Item ids are short snake_case keys (lib/equipment-items.ts, plus retired ones still saved on old rows)
const BodySchema = z.strictObject({
  items: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), z.boolean())
    .refine(v => Object.keys(v).length <= 60),
})

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:equipment-save', user.id), 60, 10 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many saves. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { items } = parsed.data

  const admin = createServiceClient()

  const { data: hire } = await admin.from('profiles').select('id').eq('id', id).eq('role', 'newhire').maybeSingle()
  if (!hire) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: before } = await admin.from('equipment_provisioning').select('items').eq('user_id', id).maybeSingle()

  const { error } = await admin
    .from('equipment_provisioning')
    .upsert({ user_id: id, items, saved_by: user.id, saved_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (error) {
    console.error(`[equipment] save failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }

  const issuedCount = Object.values(items).filter(Boolean).length
  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      `<strong>HR</strong> saved equipment provisioning — ${issuedCount} items issued`,
    performed_by: user.id,
  })

  // Company Vehicle decides whether the Driver's License is the required ID, so the stored status is
  // recomputed whenever it changes. Unticking it cancels an unfinished vehicle request (ticking it
  // starts or restarts one through POST .../equipment/notify).
  const hadVehicle = hasCompanyVehicle(before?.items)
  const hasVehicle = hasCompanyVehicle(items)
  if (hadVehicle && !hasVehicle) await cancelVehicleRequest(admin, id, user.id)
  if (hadVehicle !== hasVehicle) {
    // Unticking the vehicle can make the hire's ID requirement met, and so approve the hire
    const { enteredPayrollQueue } = await recomputeProfileStatus(admin, id)
    if (enteredPayrollQueue) await queueHireApproved(id)
  }

  return NextResponse.json({ ok: true })
}
