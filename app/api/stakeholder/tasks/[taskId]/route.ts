import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { z } from 'zod'
import { FIELD_LIMITS } from '@/lib/field-limits'
import { zOptionalText, firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'
import { isUuid } from '@/lib/review-schemas'

const TaskBody = z.strictObject({
  note: zOptionalText('Note', FIELD_LIMITS.note, { multiline: true }),
})
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

  // Optional completion note, up to 1000 characters (an empty body is fine)
  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = TaskBody.safeParse(read.data ?? {})
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error)
    return NextResponse.json({ error: message, field }, { status: 400 })
  }
  const trimmedNote = parsed.data.note ?? ''

  const { taskId } = await params
  if (!isUuid(taskId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

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

  if (error) {
    console.error(`stakeholder task update failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
