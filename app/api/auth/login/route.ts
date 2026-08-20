import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  const { email, password } = await request.json()

  // Dedicated sign-in client — anon key, no session persistence.
  // signInWithPassword sets the user JWT as the active session on whichever
  // client instance it runs on, so we never run it on the service-role client.
  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )

  const { data: authData, error: authError } = await authClient.auth.signInWithPassword({ email, password })
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 })
  }

  // Fresh service-role client — never had signInWithPassword called on it,
  // so it uses the service-role key for every request and bypasses RLS fully.
  const admin = createServiceClient()
  console.log('[login] service key prefix:', process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 20))

  const { data: rows, error: profileError } = await admin
    .rpc('get_profile_by_email', { p_email: email })

  if (profileError) {
    console.error('[login] get_profile_by_email error:', profileError.message, profileError.code)
  }

  const profile = rows?.[0] ?? null

  if (!profile) {
    return NextResponse.json({ error: 'Account not found. Contact HR.' }, { status: 403 })
  }

  if (profile.role === 'newhire') {
    // Newhire: session is ready, no OTP needed
    return NextResponse.json({ role: 'newhire', session: authData.session })
  }

  // HR: generate 6-digit OTP, store in DB, return requiresOtp flag
  const code = Math.floor(100000 + Math.random() * 900000).toString()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString() // 5 min

  console.log('[login] inserting OTP for user_id:', authData.user.id)

  // Invalidate previous unused codes for this user
  const { error: invalidateError } = await admin
    .from('otp_codes')
    .update({ used: true })
    .eq('user_id', authData.user.id)
    .eq('used', false)
  if (invalidateError) {
    console.error('[login] invalidate old OTPs error:', invalidateError.message, invalidateError.code)
  }

  const { error: insertError } = await admin.from('otp_codes').insert({
    user_id:    authData.user.id,
    code,
    expires_at: expiresAt,
    used:       false,
  })
  console.log('[login] OTP insert error:', insertError?.message ?? null, '| code:', insertError?.code ?? null)

  // In production, send email here (e.g. via Resend or Supabase Edge Function).
  // For dev, the code is logged to the server console.
  console.log(`[DEV] OTP for ${email}: ${code}`)

  // Store session temporarily in a short-lived cookie so we can set it after OTP
  const cookieStore = await cookies()
  cookieStore.set('pending_session', JSON.stringify({
    access_token:  authData.session!.access_token,
    refresh_token: authData.session!.refresh_token,
    user_id:       authData.user.id,
  }), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   300, // 5 min
    path:     '/',
  })

  return NextResponse.json({ role: 'hr', requiresOtp: true, devCode: process.env.NODE_ENV !== 'production' ? code : undefined })
}
