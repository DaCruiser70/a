import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/encrypt'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'stakeholder') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    .select('id, assigned_to, status')
    .eq('id', taskId)
    .maybeSingle()

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (task.assigned_to !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (task.status === 'confirmed') {
    return NextResponse.json({ error: 'Task is already confirmed' }, { status: 409 })
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
