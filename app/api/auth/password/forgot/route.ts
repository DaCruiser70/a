import { NextResponse, after } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import { isNewhireAccount, sendPasswordLink } from '@/lib/password-setup'

// "Forgot password?" on the login page and on an expired link. Always the same answer, whether or
// not the email belongs to an account, and the same work before answering: the account lookup and
// the email run after the response has been sent (after()), so timing does not tell them apart.
// Only newhire-only accounts get an email. At most 3 requests per address per hour (quietly).

const BodySchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
})

const NO_STORE = { 'Cache-Control': 'no-store' }
const SENT_MESSAGE = 'If that email belongs to an account, we have sent a link. Check your inbox and spam folder.'

export async function POST(request: Request) {
  const ipLimit = await rateLimit(await rateLimitKey('password-forgot:ip', getClientIp(request)), 10, 15 * 60)
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfterSeconds) } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400, headers: NO_STORE })
  }
  const { email } = parsed.data

  // Counted for every address, real or not; over the cap the answer is the same and nothing is sent
  const emailLimit = await rateLimit(await rateLimitKey('password-forgot:email', email), 3, 60 * 60)

  if (emailLimit.allowed) {
    after(async () => {
      try {
        const admin = createServiceClient()
        // The login email only: the encrypted personal email cannot be searched
        const { data: profile } = await admin.from('profiles').select('id, role, roles').eq('aem_email', email).maybeSingle()
        if (!profile || !isNewhireAccount(profile)) return
        await sendPasswordLink(admin, profile.id, 'reset', null)
      } catch {
        console.error('[password-forgot] background send failed')
      }
    })
  }

  return NextResponse.json({ ok: true, message: SENT_MESSAGE }, { headers: NO_STORE })
}
