import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { getVoidChequeSignedUrl } from '@/lib/void-cheque'

// Returns a 60-second signed URL for the signed-in new hire's own void cheque.
// Takes no id or path — the file is always looked up from the caller's own banking_info row.
export async function GET() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()
  const url = await getVoidChequeSignedUrl(admin, user.id)
  if (!url) return NextResponse.json({ error: 'No void cheque on file' }, { status: 404 })

  return NextResponse.json({ url })
}
