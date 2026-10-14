import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { queueNotification, appUrl } from '@/lib/notify'

const BodySchema = z.strictObject({ managerId: z.uuid() })

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

// Moves the hire's plan to another manager. Every answer is kept. The plan and the profile's
// manager columns change together in reassign_manager_plan(); a hire with no plan yet gets one.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:reassign-manager', user.id), 30, 15 * 60)
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
  if (!parsed.success) return NextResponse.json({ error: 'Please choose a manager from the list.' }, { status: 400 })
  const { managerId } = parsed.data

  const admin = createServiceClient()
  const { data: result, error } = await admin.rpc('reassign_manager_plan', { p_newhire_id: id, p_manager_id: managerId })
  if (error) {
    console.error(`[reassign] reassign_manager_plan failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not change the manager. Please try again.' }, { status: 500 })
  }
  if (result === 'no_hire')    return NOT_FOUND()
  if (result === 'no_manager') return NextResponse.json({ error: 'Please choose a manager from the list.' }, { status: 400 })

  const [{ data: manager }, { data: hire }] = await Promise.all([
    admin.from('managers').select('id, full_name, email').eq('id', managerId).maybeSingle(),
    admin.from('profiles').select('full_name').eq('id', id).maybeSingle(),
  ])

  if (result === 'unchanged') {
    return NextResponse.json({ ok: true, unchanged: true, manager: manager ? { id: manager.id, name: manager.full_name } : null })
  }

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'navy',
    message:      '<strong>HR</strong> changed the reporting manager for the onboarding plan',
    performed_by: user.id,
  })

  if (manager) {
    await queueNotification({
      template:  'manager_plan_requested',
      to:        manager.email,
      dedupeKey: `manager_plan_requested:${id}:${manager.id}`,
      payload:   {
        newhireId: id,
        managerId: manager.id,
        hireName:  hire?.full_name ?? '',
        link:      appUrl(`/manager/newhire/${id}`),
      },
    })
  }

  return NextResponse.json({ ok: true, manager: manager ? { id: manager.id, name: manager.full_name, email: manager.email } : null })
}
