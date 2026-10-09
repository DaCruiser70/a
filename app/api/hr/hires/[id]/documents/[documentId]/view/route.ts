import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { getDocumentSignedUrl } from '@/lib/document-view'
import { esc } from '@/lib/safe-html'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { id, documentId } = await params

  const download = new URL(request.url).searchParams.get('download') === '1'

  const result = await getDocumentSignedUrl(admin, id, documentId, { download })
  if (!result) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      `<strong>HR</strong> ${download ? 'downloaded' : 'viewed'} ${esc(result.label)}`,
    performed_by: user.id,
  })

  return NextResponse.json({ url: result.url })
}
