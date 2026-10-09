import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { getDocumentSignedUrl } from '@/lib/document-view'
import { esc } from '@/lib/safe-html'

const PAYROLL_DOC_TYPES = new Set(['td1_federal', 'td1_provincial', 'direct_deposit'])

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const auth = await requireRole('payroll')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

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
    message:      `<strong>Payroll</strong> ${download ? 'downloaded' : 'viewed'} ${esc(result.label)}`,
    performed_by: user.id,
  })

  return NextResponse.json({ url: result.url })
}
