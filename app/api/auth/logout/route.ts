import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { OTP_SESSION_COOKIE, PENDING_SESSION_COOKIE, PENDING_SESSION_PATH } from '@/lib/otp-session'

export async function POST() {
  const supabase    = await createClient()
  const cookieStore = await cookies()

  const { error } = await supabase.auth.signOut()
  if (error) console.error(`[logout] signOut failed (code ${error.code ?? 'unknown'})`)

  const cleared = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: 0 }
  cookieStore.set(OTP_SESSION_COOKIE, '', { ...cleared, path: '/' })
  cookieStore.set(PENDING_SESSION_COOKIE, '', { ...cleared, path: PENDING_SESSION_PATH })

  return NextResponse.json({ ok: true })
}
