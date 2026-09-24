import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { documentId } = await params
  const admin = createServiceClient()

  const { data: doc } = await admin
    .from('newhire_documents')
    .select('id, user_id, file_path, form_status')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (doc.form_status === 'approved') {
    return NextResponse.json({ error: 'Cannot delete an approved document.' }, { status: 409 })
  }

  await admin.storage.from('newhire-documents').remove([doc.file_path])
  await admin.from('newhire_documents').delete().eq('id', documentId)

  return NextResponse.json({ ok: true })
}
