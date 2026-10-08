import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const ALLOWED_DOC_TYPES = new Set(['td1_federal', 'td1_provincial', 'direct_deposit'])

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (callerProfile?.role !== 'payroll') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { documentId, action, reason } = await request.json()

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }
  if (action === 'reject' && (!reason || String(reason).trim().length < 1)) {
    return NextResponse.json({ error: 'Reason required for rejection' }, { status: 400 })
  }

  // Verify document belongs to this hire and is a payroll-visible type
  const { data: doc } = await admin
    .from('newhire_documents')
    .select('id, user_id, document_type, document_label')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc || doc.user_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ALLOWED_DOC_TYPES.has(doc.document_type)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()
  const { error } = await admin.from('newhire_documents').update({
    form_status: action === 'approve' ? 'approved' : 'rejected',
    flag_reason: action === 'reject' ? String(reason).trim() : null,
    reviewed_at: now,
    reviewed_by: user.id,
    updated_at:  now,
  }).eq('id', documentId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const actionType = action === 'approve' ? 'green' : 'red'
  const reasonNote = action === 'reject' && reason ? ` — <em>${String(reason).trim()}</em>` : ''
  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  actionType,
    message:      `<strong>Payroll</strong> marked ${doc.document_label} as <strong>${action === 'approve' ? 'approved' : 'rejected'}</strong>${reasonNote}`,
    performed_by: user.id,
  })

  return NextResponse.json({ ok: true })
}
