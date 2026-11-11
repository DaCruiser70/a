import { NextResponse } from 'next/server'
import { rateLimit, rateLimitKey, rateLimitPeek, getClientIp } from '@/lib/rate-limit'
import { linkBase } from '@/lib/password-setup'
import { beginMicrosoftSignIn, microsoftLoginEnabled, MS_CALLBACK_PATH } from '@/lib/microsoft-server'
import { MS_REFUSAL_LIMIT, MS_WINDOW_SECONDS, msRefusedRedirect } from '@/lib/microsoft-routes'

// "Sign in with Microsoft": sends the browser to Microsoft through Supabase's Azure provider with
// PKCE and the basic scopes only. No request body, no query: nothing from the browser is used.
export async function GET(request: Request) {
  if (!microsoftLoginEnabled()) return NextResponse.redirect(new URL('/login', request.url), 303)

  const ip = getClientIp(request)
  const [limit, refusals] = await Promise.all([
    rateLimit(await rateLimitKey('ms-start:ip', ip), 20, MS_WINDOW_SECONDS),
    rateLimitPeek(await rateLimitKey('ms-refused:ip', ip), MS_REFUSAL_LIMIT, MS_WINDOW_SECONDS),
  ])
  if (!limit.allowed || !refusals.allowed) return msRefusedRedirect(request)

  // The callback address comes only from NEXT_PUBLIC_APP_URL (https in production), never a header
  const base = linkBase()
  if (!base) {
    console.error('[microsoft] refused: NEXT_PUBLIC_APP_URL is missing or not https')
    return msRefusedRedirect(request)
  }

  const url = await beginMicrosoftSignIn(`${base}${MS_CALLBACK_PATH}`)
  if (!url) return msRefusedRedirect(request)
  return NextResponse.redirect(url, { status: 303, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}
