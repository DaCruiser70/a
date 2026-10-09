import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { decrypt } from '@/lib/encrypt'
import { esc } from '@/lib/safe-html'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> }
) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()

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
    message:      `<strong>${esc(callerProfile?.full_name ?? 'HR')}</strong> viewed the note on <strong>${esc(task.task_name)}</strong>`,
    performed_by: user.id,
  })

  return NextResponse.json({ note })
}
