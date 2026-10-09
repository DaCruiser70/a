import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getVoidChequeSignedUrl } from '@/lib/void-cheque'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
