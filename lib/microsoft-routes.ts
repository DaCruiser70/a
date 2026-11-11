import { NextResponse } from 'next/server'
import { linkBase } from '@/lib/password-setup'

// Shared by the Microsoft start and callback routes

export const MS_WINDOW_SECONDS = 15 * 60
export const MS_REFUSAL_LIMIT  = 10    // refused Microsoft sign-ins per address per window, then everything is refused

const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

// Same-origin redirects only: built on NEXT_PUBLIC_APP_URL (never a request header) when it is set,
// and only ever to a fixed path chosen by the server
export function appRedirect(request: Request, path: string): NextResponse {
  const base = linkBase() ?? new URL(request.url).origin
  return NextResponse.redirect(new URL(path, `${base}/`), { status: 303, headers: NO_STORE })
}

// The only outcome a refused person ever sees: the login page with the one refusal message.
// 303 so the browser follows with GET; nothing about the reason is in the URL.
export function msRefusedRedirect(request: Request): NextResponse {
  return appRedirect(request, '/login?ms=refused')
}
