import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: hireId } = await params

  const { data: tasks } = await admin
    .from('stakeholder_tasks')
    .select('*')
    .eq('newhire_id', hireId)
    .order('created_at', { ascending: true })

  if (!tasks || tasks.length === 0) {
    return NextResponse.json({ tasks: [] })
  }

  // Enrich with stakeholder display names (safe — no hire PII)
  const assignedIds = [...new Set(tasks.map(t => t.assigned_to))]
  const { data: stakeholderProfiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', assignedIds)

  const nameMap: Record<string, string | null> = Object.fromEntries(
    (stakeholderProfiles ?? []).map(p => [p.id, p.full_name])
  )

  const enriched = tasks.map(t => ({
    ...t,
    stakeholder_name: nameMap[t.assigned_to] ?? null,
  }))

  return NextResponse.json({ tasks: enriched })
}
