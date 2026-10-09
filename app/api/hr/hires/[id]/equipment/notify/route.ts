import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { STAKEHOLDER_MAP, EQUIPMENT_LABELS } from '@/lib/stakeholder-mapping'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const admin = createServiceClient()

  const { id: hireId } = await params
  const { newlyCheckedItems } = await request.json()

  if (!Array.isArray(newlyCheckedItems) || newlyCheckedItems.length === 0) {
    return NextResponse.json({ ok: true, tasksCreated: 0 })
  }

  // Verify hire exists
  const { data: hire } = await admin.from('profiles').select('id').eq('id', hireId).maybeSingle()
  if (!hire) return NextResponse.json({ error: 'Hire not found' }, { status: 404 })

  let tasksCreated = 0

  for (const key of newlyCheckedItems as string[]) {
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

      if (!insertError) tasksCreated++
      else console.error(`[notify] stakeholder task insert failed (code ${insertError.code})`)
    }
  }

  return NextResponse.json({ ok: true, tasksCreated })
}
