import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function POST() {
  const supabase    = await createClient()
  const cookieStore = await cookies()

  await supabase.auth.signOut()
  cookieStore.delete('otp_verified')

  return NextResponse.json({ ok: true })
}
