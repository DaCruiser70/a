import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'stakeholder') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { taskId } = await params

  // Verify task exists and belongs to this stakeholder
  const { data: task } = await admin
    .from('stakeholder_tasks')
    .select('id, assigned_to, status')
    .eq('id', taskId)
    .maybeSingle()

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (task.assigned_to !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (task.status === 'confirmed') {
    return NextResponse.json({ error: 'Task is already confirmed' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const { error } = await admin
    .from('stakeholder_tasks')
    .update({ status: 'confirmed', confirmed_at: now })
    .eq('id', taskId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
