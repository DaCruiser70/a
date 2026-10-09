import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getDocumentSignedUrl } from '@/lib/document-view'

const PAYROLL_DOC_TYPES = new Set(['td1_federal', 'td1_provincial', 'direct_deposit'])

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'payroll') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, documentId } = await params

  const { data: hire } = await admin.from('profiles').select('status').eq('id', id).single()
  if (!hire || hire.status !== 'approved') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const download = new URL(request.url).searchParams.get('download') === '1'

  const result = await getDocumentSignedUrl(admin, id, documentId, { download })
  // Treat non-payroll document types identically to not-found so payroll
  // cannot enumerate which other document types exist for a hire.
  if (!result || !PAYROLL_DOC_TYPES.has(result.document_type)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      `<strong>Payroll</strong> ${download ? 'downloaded' : 'viewed'} ${result.label}`,
    performed_by: user.id,
  })

  return NextResponse.json({ url: result.url })
}
