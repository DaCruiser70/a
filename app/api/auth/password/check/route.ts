import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import { emailName } from '@/lib/password-rules'
import { LINK_INVALID, TOKEN_PATTERN, hashToken, isNewhireAccount, sameHash } from '@/lib/password-setup'

// Step 1 of /set-password: is this link still usable? Nothing is changed or used up here.
// Answers ok with the part of the account's email before the @ (for the live checklist), or the
// one generic message. Never says whether a link was unknown, expired or used.

const BodySchema = z.strictObject({ token: z.string().regex(TOKEN_PATTERN) })

const NO_STORE = { 'Cache-Control': 'no-store' }
const invalid  = () => NextResponse.json({ error: LINK_INVALID }, { status: 410, headers: NO_STORE })

export async function POST(request: Request) {
  const limit = await rateLimit(await rateLimitKey('password-check:ip', getClientIp(request)), 30, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return invalid()

  const hash  = hashToken(parsed.data.token)
  const admin = createServiceClient()
  const { data: row } = await admin
    .from('password_setup_tokens')
    .select('user_id, token_hash, used_at, expires_at')
    .eq('token_hash', hash)
    .maybeSingle()
  if (!row || !sameHash(row.token_hash, hash) || row.used_at || new Date(row.expires_at) <= new Date()) return invalid()

  const { data: profile } = await admin.from('profiles').select('aem_email, role, roles').eq('id', row.user_id).maybeSingle()
  if (!profile || !isNewhireAccount(profile)) return invalid()

  return NextResponse.json({ ok: true, emailName: emailName(profile.aem_email) }, { headers: NO_STORE })
}
