import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { esc } from '@/lib/safe-html'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { data: callerProfile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()

  const { id } = await params
  const { noteText } = await request.json()
  if (!noteText?.trim()) return NextResponse.json({ error: 'Note cannot be empty.' }, { status: 400 })

  const { data: note, error } = await admin
    .from('hr_notes')
    .insert({ user_id: id, note_text: noteText.trim(), created_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      `<strong>${esc(callerProfile?.full_name ?? 'HR')}</strong> added an internal note`,
    performed_by: user.id,
  })

  return NextResponse.json({ note: { ...note, creator_name: callerProfile?.full_name ?? 'HR' } })
}
