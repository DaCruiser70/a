import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { encrypt } from '@/lib/encrypt'
import { VEHICLE_TASK_KEYS } from '@/lib/vehicle'
import { RETIRED_TASK_KEYS } from '@/lib/stakeholder-mapping'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const auth = await requireRole('stakeholder')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  // Parse and validate optional note — must be a string ≤ 1000 characters
  let body: { note?: unknown } = {}
  try { body = await request.json() } catch { /* empty body is fine */ }

  const rawNote = body.note
  if (rawNote !== undefined && rawNote !== null && typeof rawNote !== 'string') {
    return NextResponse.json({ error: 'Invalid note' }, { status: 400 })
  }
  const trimmedNote = typeof rawNote === 'string' ? rawNote.trim() : ''
  if (trimmedNote.length > 1000) {
    return NextResponse.json({ error: 'Note must be 1000 characters or fewer' }, { status: 400 })
  }

  const { taskId } = await params

  // Verify task exists and belongs to this stakeholder
  const { data: task } = await admin
    .from('stakeholder_tasks')
    .select('id, assigned_to, status, task_key, newhire_id')
    .eq('id', taskId)
    .maybeSingle()

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (task.assigned_to !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (task.status === 'confirmed') {
    return NextResponse.json({ error: 'Task is already confirmed' }, { status: 409 })
  }
  if (RETIRED_TASK_KEYS.includes(task.task_key)) {
    return NextResponse.json({ error: 'This item is no longer part of onboarding.' }, { status: 409 })
  }
  // A vehicle task that belongs to a vehicle request is completed only through the ordered vehicle
  // route (Rob → Heather → Marley). Old three-person vehicle tasks (no request) keep working as before.
  if (VEHICLE_TASK_KEYS.includes(task.task_key)) {
    const { data: request } = await admin.from('vehicle_requests').select('id').eq('newhire_id', task.newhire_id).maybeSingle()
    if (request) return NextResponse.json({ error: 'Use the vehicle form to complete this task.' }, { status: 409 })
  }

  const now       = new Date().toISOString()
  const noteEnc   = trimmedNote.length > 0 ? encrypt(trimmedNote) : null

  const { error } = await admin
    .from('stakeholder_tasks')
    .update({ status: 'confirmed', confirmed_at: now, completion_note_enc: noteEnc })
    .eq('id', taskId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
