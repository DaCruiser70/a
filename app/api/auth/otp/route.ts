import { NextResponse } from 'next/server'
import { createServiceClient, createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const { code } = await request.json()
  console.log('[otp] received code:', code)

  const cookieStore = await cookies()

  const pendingRaw = cookieStore.get('pending_session')?.value
  console.log('[otp] pending_session cookie present:', !!pendingRaw)
  if (!pendingRaw) {
    return NextResponse.json({ error: 'Session expired. Please sign in again.' }, { status: 401 })
  }

  const pending = JSON.parse(pendingRaw) as { access_token: string; refresh_token: string; user_id: string }
  console.log('[otp] user_id from cookie:', pending.user_id)

  const supabase = createServiceClient()

  // SECURITY DEFINER function bypasses RLS on otp_codes — same pattern as get_profile_by_email
  const { data: rows, error: otpError } = await supabase
    .rpc('get_pending_otp', { p_user_id: pending.user_id })

  console.log('[otp] RPC rows:', JSON.stringify(rows), '| error:', otpError?.message ?? null)

  const otpRow = rows?.[0] ?? null

  if (!otpRow) {
    console.log('[otp] FAIL: no matching OTP row found')
    return NextResponse.json({ error: 'Code not found or already used.' }, { status: 400 })
  }

  console.log('[otp] DB code:', otpRow.code, '| expires_at:', otpRow.expires_at)

  if (new Date(otpRow.expires_at) < new Date()) {
    console.log('[otp] FAIL: code expired at', otpRow.expires_at)
    return NextResponse.json({ error: 'Code has expired. Please sign in again.' }, { status: 400 })
  }

  console.log('[otp] code match:', otpRow.code === code, `(db="${otpRow.code}" input="${code}")`)
  if (otpRow.code !== code) {
    return NextResponse.json({ error: 'Incorrect code. Please try again.' }, { status: 400 })
  }

  // Mark OTP as used
  await supabase.from('otp_codes').update({ used: true }).eq('id', otpRow.id)

  // Write the Supabase session into cookies server-side so the middleware sees
  // it immediately on the next request — no client-side setSession needed.
  const ssrClient = await createClient()
  await ssrClient.auth.setSession({
    access_token:  pending.access_token,
    refresh_token: pending.refresh_token,
  })

  // Clear the pending session cookie
  cookieStore.delete('pending_session')

  // Set the otp_verified cookie (session-scoped)
  cookieStore.set('otp_verified', '1', {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   60 * 60 * 8, // 8 hours
    path:     '/',
  })

  return NextResponse.json({ ok: true })
}
