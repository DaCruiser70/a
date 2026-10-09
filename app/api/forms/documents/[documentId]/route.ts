import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

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
