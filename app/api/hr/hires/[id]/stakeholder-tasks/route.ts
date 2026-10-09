import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const admin = createServiceClient()

  const { id: hireId } = await params

  // Select all columns including completion_note_enc so we can derive has_note.
  // The note ciphertext is NEVER included in the response — only the boolean flag.
  const { data: tasks } = await admin
    .from('stakeholder_tasks')
    .select('id, newhire_id, assigned_to, task_key, task_name, task_details, status, confirmed_at, completion_note_enc, created_at')
    .eq('newhire_id', hireId)
    .order('created_at', { ascending: true })

  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ tasks: [] })
  }

  // Enrich with stakeholder display names (safe — no hire PII)
  const assignedIds = [...new Set(tasks.map(t => t.assigned_to))]
  const { data: stakeholderProfiles } = await admin
    .from('profiles')
    .select('id, full_name, aem_email')
    .in('id', assignedIds)

  const nameMap: Record<string, string> = Object.fromEntries(
    (stakeholderProfiles ?? []).map(p => [p.id, p.full_name || p.aem_email || '—'])
  )

  // Explicitly construct each response object — never spread t to avoid leaking completion_note_enc
  const enriched = tasks.map(t => ({
    id:               t.id,
    newhire_id:       t.newhire_id,
    assigned_to:      t.assigned_to,
    task_key:         t.task_key,
    task_name:        t.task_name,
    task_details:     t.task_details,
    status:           t.status,
    confirmed_at:     t.confirmed_at,
    created_at:       t.created_at,
    has_note:         !!t.completion_note_enc,
    stakeholder_name: nameMap[t.assigned_to] ?? '—',
  }))

  return NextResponse.json({ tasks: enriched })
}
