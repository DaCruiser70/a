import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getVoidChequeSignedUrl } from '@/lib/void-cheque'

// Returns a 60-second signed URL for the signed-in new hire's own void cheque.
// Takes no id or path — the file is always looked up from the caller's own banking_info row.
export async function GET() {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const url = await getVoidChequeSignedUrl(admin, user.id)
  if (!url) return NextResponse.json({ error: 'No void cheque on file' }, { status: 404 })

  return NextResponse.json({ url })
}
