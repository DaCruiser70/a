import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { getVoidChequeSignedUrl } from '@/lib/void-cheque'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { id } = await params

  const download = new URL(request.url).searchParams.get('download') === '1'

  const url = await getVoidChequeSignedUrl(admin, id, { download })
  if (!url) return NextResponse.json({ error: 'No void cheque on file' }, { status: 404 })

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      download ? '<strong>HR</strong> downloaded the void cheque' : '<strong>HR</strong> viewed the void cheque',
    performed_by: user.id,
  })

  return NextResponse.json({ url })
}
