import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit, rateLimitKey, getClientIp } from '@/lib/rate-limit'
import { PASSWORD_MAX, emailName, passwordError } from '@/lib/password-rules'
import {
  LINK_INVALID, PASSWORD_SET_AUDIT_PREFIX, TOKEN_PATTERN,
  audit, hashToken, isNewhireAccount, sameHash,
} from '@/lib/password-setup'

// Step 2 of /set-password: checks the rules, then uses the link up and sets the password.
// The link is claimed by ONE conditional UPDATE (consume_password_token), so two clicks or two tabs
// cannot both succeed. Every earlier session and refresh token for the account is then revoked.
// Newhire-only accounts only. Never logs the token, its hash, the password or the address.

const BodySchema = z.strictObject({
  token:    z.string().regex(TOKEN_PATTERN),
  // A little over the maximum, so a too-long password gets the friendly rule message
  password: z.string().max(PASSWORD_MAX * 2),
  confirm:  z.string().max(PASSWORD_MAX * 2),
})

const NO_STORE = { 'Cache-Control': 'no-store' }
const invalid  = () => NextResponse.json({ error: LINK_INVALID, linkInvalid: true }, { status: 410, headers: NO_STORE })
const failed   = () => NextResponse.json(
  { error: 'We could not set your password. Please try again in a minute.' }, { status: 500, headers: NO_STORE })

export async function POST(request: Request) {
  const ipLimit = await rateLimit(await rateLimitKey('password-set:ip', getClientIp(request)), 20, 15 * 60)
  if (!ipLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfterSeconds) } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    // A malformed token is just an invalid link; anything else is a bad request
    const tokenOk = typeof (raw as { token?: unknown })?.token === 'string'
      && TOKEN_PATTERN.test((raw as { token: string }).token)
    return tokenOk ? NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE }) : invalid()
  }
  const { token, password, confirm } = parsed.data
  const hash = hashToken(token)

  // Per link as well as per address: the hash is the only identifier this route has before the claim
  const linkLimit = await rateLimit(await rateLimitKey('password-set:link', hash), 10, 15 * 60)
  if (!linkLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(linkLimit.retryAfterSeconds) } },
    )
  }

  const admin = createServiceClient()
  const { data: row } = await admin
    .from('password_setup_tokens')
    .select('id, user_id, purpose, token_hash, used_at, expires_at')
    .eq('token_hash', hash)
    .maybeSingle()
  if (!row || !sameHash(row.token_hash, hash)) return invalid()

  if (row.used_at || new Date(row.expires_at) <= new Date()) {
    await audit(admin, row.user_id, row.user_id, `Password link attempt failed (${row.purpose} link no longer valid)`, 'amber')
    return invalid()
  }

  const { data: profile } = await admin.from('profiles').select('aem_email, role, roles').eq('id', row.user_id).maybeSingle()
  if (!profile || !isNewhireAccount(profile)) {
    if (profile) await audit(admin, row.user_id, row.user_id, `Password link attempt failed (${row.purpose} link, not a new hire account)`, 'red')
    return invalid()
  }

  // The rules, before anything is used up, so the person can fix the password and try again
  const ruleError = passwordError(password, confirm, emailName(profile.aem_email))
  if (ruleError) return NextResponse.json({ error: ruleError }, { status: 400, headers: NO_STORE })

  // The claim: exactly one caller gets a row back
  const { data: claimed, error: claimError } = await admin.rpc('consume_password_token', { p_token_hash: hash })
  if (claimError) {
    console.error(`[password-set] claim failed (code ${claimError.code})`)
    return failed()
  }
  const claim = claimed?.[0]
  if (!claim || claim.user_id !== row.user_id || !sameHash(claim.token_hash, hash)) {
    await audit(admin, row.user_id, row.user_id, `Password link attempt failed (${row.purpose} link already used)`, 'amber')
    return invalid()
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(claim.user_id, { password })
  if (updateError) {
    console.error(`[password-set] password update failed (status ${updateError.status ?? 'unknown'})`)
    // Give the link back (if it has not expired meanwhile) so the person can try again
    const { error: releaseError } = await admin
      .from('password_setup_tokens')
      .update({ used_at: null })
      .eq('id', claim.token_id)
      .gt('expires_at', new Date().toISOString())
    if (releaseError) console.error(`[password-set] link release failed (code ${releaseError.code})`)
    return failed()
  }

  // Anything signed in before this moment stops working
  const { data: revoked, error: revokeError } = await admin.rpc('revoke_user_sessions', { p_user_id: claim.user_id })
  if (revokeError || revoked === -1) console.error(`[password-set] session revoke failed (code ${revokeError?.code ?? 'refused'})`)

  await audit(admin, claim.user_id, claim.user_id,
    `${PASSWORD_SET_AUDIT_PREFIX} the ${claim.purpose === 'welcome' ? 'welcome' : 'reset'} link`, 'green')

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
