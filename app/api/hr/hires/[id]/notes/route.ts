import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  const { data: callerProfile } = await admin.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    message:      `<strong>${callerProfile.full_name}</strong> added an internal note`,
    performed_by: user.id,
  })

  return NextResponse.json({ note: { ...note, creator_name: callerProfile.full_name } })
}
