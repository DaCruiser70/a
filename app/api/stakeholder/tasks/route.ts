import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'

export async function GET() {
  const auth = await requireRole('stakeholder')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  // Fetch only this stakeholder's visible tasks — hidden rows are excluded here.
  // HR views use a separate route that ignores hidden_from_stakeholder.
  const { data: tasks } = await admin
    .from('stakeholder_tasks')
    .select('id, newhire_id, task_key, task_name, status, confirmed_at, created_at')
    .eq('assigned_to', user.id)
    .eq('hidden_from_stakeholder', false)
    .order('created_at', { ascending: true })

  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ hires: [] })
  }

  // Fetch hire info — only non-sensitive fields
  const hireIds = [...new Set(tasks.map(t => t.newhire_id))]
  const { data: hireProfiles } = await admin
    .from('profiles')
    .select('id, full_name, position, start_date')
    .in('id', hireIds)

  const hireMap = Object.fromEntries(
    (hireProfiles ?? []).map(p => [p.id, p])
  )

  // Group tasks by hire — expose hire_id in response for client routing
  const grouped: Record<string, {
    hire_id: string
    hire_name: string
    hire_role: string | null
    hire_start_date: string | null
    tasks: typeof tasks
    pending_count: number
    total_count: number
  }> = {}

  for (const task of tasks) {
    if (!grouped[task.newhire_id]) {
      const hp = hireMap[task.newhire_id]
      grouped[task.newhire_id] = {
        hire_id:         task.newhire_id,
        hire_name:       hp?.full_name  ?? 'Unknown',
        hire_role:       hp?.position   ?? null,
        hire_start_date: hp?.start_date ?? null,
        tasks:           [],
        pending_count:   0,
        total_count:     0,
      }
    }
    grouped[task.newhire_id].tasks.push(task)
    grouped[task.newhire_id].total_count++
    if (task.status === 'pending') grouped[task.newhire_id].pending_count++
  }

  return NextResponse.json({ hires: Object.values(grouped) })
}
