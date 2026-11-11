import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { z } from 'zod'
import { ALL_EQUIPMENT_ITEMS } from '@/lib/equipment-items'
import { readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'
import { isUuid } from '@/lib/review-schemas'

const EQUIPMENT_KEYS: string[] = ALL_EQUIPMENT_ITEMS.map(i => i.id)
const NotifyBody = z.strictObject({
  newlyCheckedItems: z.array(z.string().max(60).refine(k => EQUIPMENT_KEYS.includes(k))).max(EQUIPMENT_KEYS.length),
})
import { STAKEHOLDER_MAP, EQUIPMENT_LABELS } from '@/lib/stakeholder-mapping'
import { startVehicleRequest } from '@/lib/vehicle-server'
import { queueNotification } from '@/lib/notify'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { id: hireId } = await params
  if (!isUuid(hireId)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Only known equipment keys, each at most once
  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = NotifyBody.safeParse(read.data)
  if (!parsed.success) return NextResponse.json({ error: INVALID_REQUEST }, { status: 400 })
  const newlyCheckedItems = [...new Set(parsed.data.newlyCheckedItems)]

  if (newlyCheckedItems.length === 0) {
    return NextResponse.json({ ok: true, tasksCreated: 0 })
  }

  // Verify hire exists
  const { data: hire } = await admin.from('profiles').select('id').eq('id', hireId).maybeSingle()
  if (!hire) return NextResponse.json({ error: 'Hire not found' }, { status: 404 })

  let tasksCreated = 0
  // New tasks per stakeholder, for one notice each (one email even when one person gets two tasks)
  const createdFor = new Map<string, string[]>()

  for (const key of newlyCheckedItems) {
    // Company Vehicle is a sequence: only Rob's task now; Heather and Marley follow in turn
    if (key === 'vehicle') {
      if ((await startVehicleRequest(admin, hireId, user.id)) === 'started') tasksCreated++
      continue
    }
    const emails = STAKEHOLDER_MAP[key]
    if (!emails || emails.length === 0) continue

    for (const email of emails) {
      const { data: stakeholder } = await admin
        .from('profiles')
        .select('id')
        .eq('aem_email', email)
        .contains('roles', ['stakeholder'])
        .maybeSingle()

      if (!stakeholder) continue

      const payload = {
        newhire_id:   hireId,
        assigned_to:  stakeholder.id,
        task_key:     key,
        task_name:    EQUIPMENT_LABELS[key] ?? key,
        task_details: null,
        status:       'pending' as const,
        confirmed_at: null,
      }
      // Explicit existence check — do not rely on a unique constraint
      const { data: existing } = await admin
        .from('stakeholder_tasks')
        .select('id, status')
        .eq('newhire_id', hireId)
        .eq('assigned_to', stakeholder.id)
        .eq('task_key', key)
        .maybeSingle()

      if (existing) continue

      const { error: insertError } = await admin
        .from('stakeholder_tasks')
        .insert(payload)

      if (!insertError) {
        tasksCreated++
        createdFor.set(stakeholder.id, [...(createdFor.get(stakeholder.id) ?? []), key])
      } else console.error(`[notify] stakeholder task insert failed (code ${insertError.code})`)
    }
  }

  // The task keys are the version: saving again with the same new tasks adds nothing
  for (const [assigneeId, keys] of createdFor) {
    const taskKeys = [...new Set(keys)].sort()
    await queueNotification({ template: 'stakeholder_tasks_created', hireId, payload: { assigneeId, taskKeys }, version: taskKeys.join('+') })
  }

  return NextResponse.json({ ok: true, tasksCreated })
}
