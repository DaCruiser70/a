import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  // file_path is deliberately excluded — storage paths never leave the server
  const { data: documents } = await admin
    .from('newhire_documents')
    .select('id, user_id, document_type, document_label, file_name, file_size, expiry_date, form_status, flag_reason, uploaded_at, updated_at, reviewed_at, reviewed_by, sharepoint_filed, sharepoint_filed_at')
    .eq('user_id', id)
    .order('uploaded_at', { ascending: true })

  return NextResponse.json({ documents: documents ?? [] })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json()
  const { documentId, action, reason } = body

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
  if (action === 'reject' && (!reason || String(reason).trim().length < 1)) {
    return NextResponse.json({ error: 'Reason required for rejection' }, { status: 400 })
  }

  // Verify document belongs to the specified hire
  const { data: doc } = await admin
    .from('newhire_documents')
    .select('id, user_id')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc || doc.user_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin.from('newhire_documents').update({
    form_status: action === 'approve' ? 'approved' : 'rejected',
    flag_reason: action === 'reject' ? String(reason).trim() : null,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
    updated_at:  new Date().toISOString(),
  }).eq('id', documentId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
