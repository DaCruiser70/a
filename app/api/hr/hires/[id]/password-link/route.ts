import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { isNewhireAccount, passwordLinkStatus, sendPasswordLink } from '@/lib/password-setup'

// The hire's set-password link on the HR hire page.
//   GET:  the newest link's state (Waiting, Password set, Expired, Not sent) and the masked address
//   POST: { action: 'welcome' } resends the welcome email (only before a password is set);
//         { action: 'reset' } sends a password reset (after a password is set, or for an account
//         created before email links). A new link stops every earlier unused one working.
// No token, hash or full address ever leaves the server.

const BodySchema = z.strictObject({ action: z.enum(['welcome', 'reset']) })

const NO_STORE  = { 'Cache-Control': 'no-store' }
const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })

async function loadHire(id: string) {
  if (!z.uuid().safeParse(id).success) return null
  const admin = createServiceClient()
  const { data } = await admin.from('profiles').select('id, role, roles').eq('id', id).maybeSingle()
  return data && isNewhireAccount(data) ? { admin, hire: data } : null
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const limit = await rateLimit(await rateLimitKey('hr:password-link:read', auth.user.id), 240, 5 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  const found = await loadHire(id)
  if (!found) return NOT_FOUND()

  return NextResponse.json(await passwordLinkStatus(found.admin, id), { headers: NO_STORE })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE })
  const { action } = parsed.data

  // Per HR user, then per hire: 1 a minute and 5 a day, whoever sends them
  const limits = [
    ['hr:password-link:user', user.id, 30, 60 * 60],
    ['hr:password-link:hire-1m', id, 1, 60],
    ['hr:password-link:hire-1d', id, 5, 24 * 60 * 60],
  ] as const
  for (const [scope, value, max, window] of limits) {
    const limit = await rateLimit(await rateLimitKey(scope, value), max, window)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: scope.endsWith('1d')
            ? 'This hire has had 5 emails today. Please try again tomorrow.'
            : 'An email was just sent. Please wait a minute before sending another.' },
        { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSeconds) } },
      )
    }
  }

  const found = await loadHire(id)
  if (!found) return NOT_FOUND()
  const { admin } = found

  const status = await passwordLinkStatus(admin, id)
  const noLinkEver = status.state === 'none'
  if (action === 'welcome' && status.passwordSet) {
    return NextResponse.json({ error: 'This hire has already set a password. Send a password reset instead.' }, { status: 409, headers: NO_STORE })
  }
  if (action === 'reset' && !status.passwordSet && !noLinkEver) {
    return NextResponse.json({ error: 'This hire has not set a password yet. Resend the welcome email instead.' }, { status: 409, headers: NO_STORE })
  }

  const result = await sendPasswordLink(admin, id, action, user.id)
  if (result.outcome === 'refused') return NOT_FOUND()
  if (result.outcome === 'not_sent') {
    return NextResponse.json(
      { error: 'The email could not be sent. The account is unchanged. Please try again in a minute.', to: result.maskedTo },
      { status: 502, headers: NO_STORE },
    )
  }
  return NextResponse.json({ ok: true, to: result.maskedTo }, { headers: NO_STORE })
}
