import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { NoteBody, isUuid } from '@/lib/review-schemas'
import { firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'
import { esc } from '@/lib/safe-html'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { data: callerProfile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = NoteBody.safeParse(read.data)
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error)
    return NextResponse.json({ error: message, field }, { status: 400 })
  }
  const { noteText } = parsed.data

  const { data: note, error } = await admin
    .from('hr_notes')
    .insert({ user_id: id, note_text: noteText, created_by: user.id })
    .select()
    .single()

  if (error) {
    console.error(`hr_notes insert failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save the note. Please try again.' }, { status: 500 })
  }

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      `<strong>${esc(callerProfile?.full_name ?? 'HR')}</strong> added an internal note`,
    performed_by: user.id,
  })

  return NextResponse.json({ note: { ...note, creator_name: callerProfile?.full_name ?? 'HR' } })
}
