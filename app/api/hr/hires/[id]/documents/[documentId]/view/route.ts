import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, documentId } = await params

  const { data: doc } = await admin
    .from('newhire_documents')
    .select('file_path, user_id')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc || doc.user_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: signedData, error: signedError } = await admin.storage
    .from('newhire-documents')
    .createSignedUrl(doc.file_path, 60)

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json({ error: 'Could not generate document URL' }, { status: 500 })
  }

  return NextResponse.json({ url: signedData.signedUrl })
}
