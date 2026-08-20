import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  const { data: banking } = await admin
    .from('banking_info')
    .select('void_cheque_path')
    .eq('user_id', id)
    .maybeSingle()

  if (!banking?.void_cheque_path) return NextResponse.json({ error: 'No void cheque on file' }, { status: 404 })

  const { data: signedData, error } = await admin.storage
    .from('void-cheques')
    .createSignedUrl(banking.void_cheque_path, 60)

  if (error || !signedData) return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 })

  return NextResponse.json({ url: signedData.signedUrl })
}
