import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'

// Service-role client for role lookups — bypasses RLS so the middleware never
// gets a null profile due to missing SELECT policies on the profiles table.
function makeAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

async function getRole(userId: string): Promise<string | null> {
  const { data } = await makeAdmin()
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()
  return data?.role ?? null
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // SSR client — used only to validate the session JWT via getUser()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // Not logged in → redirect to login (except for login itself and api routes)
  if (!user && !pathname.startsWith('/login') && !pathname.startsWith('/api')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Logged in user hitting /login → redirect to their portal
  if (user && pathname === '/login') {
    const role = await getRole(user.id)
    const dest = role === 'hr' ? '/hr/dashboard' : '/newhire/welcome'
    return NextResponse.redirect(new URL(dest, request.url))
  }

  // HR routes: must be authenticated AND have completed OTP
  if (pathname.startsWith('/hr')) {
    if (!user) {
      console.log('[middleware] /hr — no user, redirecting to login')
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const role = await getRole(user.id)
    const otpVerified = request.cookies.get('otp_verified')?.value
    console.log('[middleware] /hr —', { userId: user.id, role, otpVerified: otpVerified ?? null })

    if (role !== 'hr') {
      console.log('[middleware] /hr — role is not hr, redirecting to /newhire/welcome')
      return NextResponse.redirect(new URL('/newhire/welcome', request.url))
    }

    // OTP gate: HR must have verified OTP this session
    if (!otpVerified) {
      console.log('[middleware] /hr — otp_verified missing, redirecting to login')
      const redirectUrl = new URL('/login', request.url)
      redirectUrl.searchParams.set('otp_required', '1')
      return NextResponse.redirect(redirectUrl)
    }
  }

  // Newhire routes: must be authenticated as newhire
  if (pathname.startsWith('/newhire')) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    const role = await getRole(user.id)
    if (role === 'hr') {
      return NextResponse.redirect(new URL('/hr/dashboard', request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|logo.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
