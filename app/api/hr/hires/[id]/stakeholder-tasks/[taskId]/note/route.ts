import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/encrypt'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: hireId, taskId } = await params

  // Verify the task exists and belongs to the hire in the URL
  const { data: task } = await admin
    .from('stakeholder_tasks')
    .select('id, newhire_id, task_name, completion_note_enc')
    .eq('id', taskId)
    .maybeSingle()

  if (!task || task.newhire_id !== hireId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!task.completion_note_enc) {
    return NextResponse.json({ error: 'No note' }, { status: 404 })
  }

  // Decrypt server-side — note content never touches the client in any other form
  const note = decrypt(task.completion_note_enc)

  // Audit trail — message contains no note content
  await admin.from('audit_log').insert({
    user_id:      hireId,
    action_type:  'amber' as const,
    message:      `<strong>${callerProfile.full_name ?? 'HR'}</strong> viewed the note on <strong>${task.task_name}</strong>`,
    performed_by: user.id,
  })

  return NextResponse.json({ note })
}
