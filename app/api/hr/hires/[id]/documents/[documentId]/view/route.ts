import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getDocumentSignedUrl } from '@/lib/document-view'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, documentId } = await params

  const download = new URL(request.url).searchParams.get('download') === '1'

  const result = await getDocumentSignedUrl(admin, id, documentId, { download })
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      `<strong>HR</strong> ${download ? 'downloaded' : 'viewed'} ${result.label}`,
    performed_by: user.id,
  })

  return NextResponse.json({ url: result.url })
}
