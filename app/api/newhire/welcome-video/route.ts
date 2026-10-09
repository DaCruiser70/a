import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { WELCOME_MEDIA_BUCKET, WELCOME_VIDEO_FILE } from '@/lib/media'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Returns a 1-hour signed URL for the welcome video. New hires and HR (for previewing) only.
// The storage path is a constant — no request input reaches it.
export async function GET() {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'newhire' && callerProfile?.role !== 'hr') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const { data: signedData, error } = await admin.storage
    .from(WELCOME_MEDIA_BUCKET)
    .createSignedUrl(WELCOME_VIDEO_FILE, 3600)

  // Missing object (or any signing failure): 404 with no detail
  if (error || !signedData?.signedUrl) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })
  }

  return NextResponse.json({ url: signedData.signedUrl }, { headers: NO_STORE })
}
