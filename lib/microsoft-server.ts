import { cookies } from 'next/headers'
import { createClient as createSupabaseClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { Database } from '@/types'
import { createClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/encrypt'
import { signOtpSession, OTP_SESSION_COOKIE, OTP_SESSION_MAX_AGE } from '@/lib/otp-session'
import {
  decideMicrosoftSignIn, microsoftAuditMessage, pickPmAccount, STAFF_OVER_MEMBER,
  type BindingOwner, type MicrosoftBinding, type MicrosoftClaims, type MicrosoftDecision,
} from '@/lib/microsoft-auth'
import type { MicrosoftEvent } from '@/lib/microsoft-flow'

// Server only. The Microsoft sign-in flow around the pure rules in lib/microsoft-auth.ts.
// Never logged or stored: Microsoft tokens, Supabase tokens from the exchange, emails, codes.

type Admin = SupabaseClient<Database>

export const MS_FLOW_COOKIE = 'ms_oauth'
export const MS_FLOW_PATH   = '/api/auth/microsoft'
export const MS_FLOW_TTL    = 600            // seconds the start of a sign-in stays usable
export const MS_CALLBACK_PATH = '/api/auth/microsoft/callback'
export const MS_SCOPES      = 'openid profile email'
const STORAGE_KEY = 'ms'

export function microsoftLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MICROSOFT_LOGIN_ENABLED === 'true'
}

const cookieFlags = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const }

// A throwaway Supabase client whose storage is a Map in this request only: the PKCE verifier and the
// session from the exchange never reach Supabase's own cookies or any browser.
function oauthClient(store: Map<string, string>) {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: 'pkce', persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
        storageKey: STORAGE_KEY,
        storage: {
          getItem:    key => store.get(key) ?? null,
          setItem:    (key, value) => { store.set(key, value) },
          removeItem: key => { store.delete(key) },
        },
      },
    },
  )
}

type FlowCookie = { v: string; t: number }

// Step 1: the Microsoft authorize URL (through Supabase, PKCE, basic scopes only). The verifier goes
// into our own encrypted, HttpOnly, path-scoped, 10-minute cookie.
export async function beginMicrosoftSignIn(redirectTo: string): Promise<string | null> {
  const store = new Map<string, string>()
  const { data, error } = await oauthClient(store).auth.signInWithOAuth({
    provider: 'azure',
    options:  { redirectTo, scopes: MS_SCOPES, skipBrowserRedirect: true },
  })
  const verifier = store.get(`${STORAGE_KEY}-code-verifier`)
  if (error || !data?.url || !verifier) {
    console.error(`[microsoft] start failed (${error?.code ?? 'no url or verifier'})`)
    return null
  }
  const value: FlowCookie = { v: verifier, t: Math.floor(Date.now() / 1000) }
  ;(await cookies()).set(MS_FLOW_COOKIE, encrypt(JSON.stringify(value)), { ...cookieFlags, path: MS_FLOW_PATH, maxAge: MS_FLOW_TTL })
  return data.url
}

// Reads and always deletes the start cookie: one callback per start, so a replayed callback has none
export async function takeFlowCookie(): Promise<string | null> {
  const store = await cookies()
  const raw = store.get(MS_FLOW_COOKIE)?.value
  store.set(MS_FLOW_COOKIE, '', { ...cookieFlags, path: MS_FLOW_PATH, maxAge: 0 })
  if (!raw || raw.length > 4096) return null
  try {
    const parsed = JSON.parse(decrypt(raw)) as Partial<FlowCookie>
    if (typeof parsed.v !== 'string' || !/^[^/]{20,200}\/?[A-Za-z_]*$/.test(parsed.v) || typeof parsed.t !== 'number') return null
    if (Math.floor(Date.now() / 1000) - parsed.t > MS_FLOW_TTL) return null
    return parsed.v
  } catch {
    return null
  }
}

// Step 2: exchange the one-time code. The session is only read here, never kept.
export async function exchangeMicrosoftCode(code: string, verifierEntry: string): Promise<{ user: User; accessToken: string } | null> {
  const store = new Map<string, string>([[`${STORAGE_KEY}-code-verifier`, verifierEntry]])
  const { data, error } = await oauthClient(store).auth.exchangeCodeForSession(code)
  if (error || !data.session || !data.user) {
    console.error(`[microsoft] exchange failed (${error?.code ?? 'no session'})`)
    return null
  }
  return { user: data.user, accessToken: data.session.access_token }
}

// The Microsoft identity on the exchanged user: the most recently used azure identity. Values come
// from Supabase's own exchange with Microsoft, not from the browser.
export function microsoftClaimsFrom(user: User): MicrosoftClaims {
  const azure = (user.identities ?? [])
    .filter(i => i.provider === 'azure')
    .sort((a, b) => (b.last_sign_in_at ?? '').localeCompare(a.last_sign_in_at ?? ''))[0]
  const d = (azure?.identity_data ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    email:         str(d.email),
    subject:       str(d.sub) ?? str(azure?.id),
    // The token issuer (the Entra tenant). If Supabase ever omits it, the subject alone is the key.
    issuer:        str(d.iss) ?? (azure ? 'azure' : null),
    emailVerified: typeof d.email_verified === 'boolean' ? d.email_verified : null,
  }
}

// Everything the rules need from our database, by service role
export async function decideFromDatabase(admin: Admin, claims: MicrosoftClaims): Promise<MicrosoftDecision> {
  const email = claims.email?.trim().toLowerCase() ?? ''
  const fail = (userId: string | null = null): MicrosoftDecision =>
    ({ allow: false, reason: 'error', userId, memberId: null, alsoMember: false })
  if (!email) {
    return decideMicrosoftSignIn({ claims, candidates: [], members: [], bindings: [] })
  }

  const [accounts, members] = await Promise.all([
    admin.rpc('microsoft_sign_in_candidates', { p_email: email }),
    admin.rpc('microsoft_member_candidates', { p_email: email }),
  ])
  if (accounts.error || members.error) {
    console.error(`[microsoft] account lookup failed (code ${accounts.error?.code ?? members.error?.code})`)
    return fail()
  }
  const candidates = (accounts.data ?? []).map(c => ({ id: c.id, roles: c.roles ?? [], active: c.active === true }))
  const memberRows = (members.data ?? []).map(m => ({ id: m.id, region: m.region, active: m.active === true }))

  // The stored ids that can matter: this Microsoft id's owner, the account's and the members'
  const profileIds = candidates.map(c => c.id)
  const memberIds  = memberRows.map(m => m.id)
  const cols = 'profile_id, member_id, ms_subject, ms_issuer'
  const none = Promise.resolve({ data: [] as { profile_id: string | null; member_id: string | null; ms_subject: string; ms_issuer: string }[], error: null })
  const [bySubject, byProfile, byMember] = await Promise.all([
    claims.subject && claims.issuer
      ? admin.from('microsoft_identities').select(cols).eq('ms_subject', claims.subject).eq('ms_issuer', claims.issuer)
      : none,
    profileIds.length ? admin.from('microsoft_identities').select(cols).in('profile_id', profileIds) : none,
    memberIds.length  ? admin.from('microsoft_identities').select(cols).in('member_id', memberIds)   : none,
  ])
  if (bySubject.error || byProfile.error || byMember.error) {
    console.error('[microsoft] binding lookup failed')
    return fail(candidates.length === 1 ? candidates[0].id : null)
  }
  const bindings: MicrosoftBinding[] = []
  for (const row of [...(bySubject.data ?? []), ...(byProfile.data ?? []), ...(byMember.data ?? [])]) {
    const owner: BindingOwner | null = row.profile_id ? { kind: 'profile', id: row.profile_id }
      : row.member_id ? { kind: 'member', id: row.member_id } : null
    if (owner) bindings.push({ owner, subject: row.ms_subject, issuer: row.ms_issuer })
  }
  return decideMicrosoftSignIn({ claims, candidates, members: memberRows, bindings })
}

// The shared regional account a member's session is created on (exactly one active, or null)
export async function pmAccountForRegion(admin: Admin, region: string): Promise<string | null> {
  const { data, error } = await admin.rpc('microsoft_pm_account', { p_region: region })
  if (error) {
    console.error(`[microsoft] regional account lookup failed (code ${error.code})`)
    return null
  }
  return pickPmAccount((data ?? []).map(r => ({ id: r.id, active: r.active === true })))
}

// First sign-in: store the Microsoft id against the account or the member. The unique constraints
// make a race or a reused id fail.
export async function bindMicrosoftIdentity(admin: Admin, owner: BindingOwner, claims: MicrosoftClaims): Promise<boolean> {
  const { error } = await admin.from('microsoft_identities').insert({
    ...(owner.kind === 'profile' ? { profile_id: owner.id } : { member_id: owner.id }),
    ms_issuer: claims.issuer!, ms_subject: claims.subject!,
  })
  if (error) console.error(`[microsoft] binding insert failed (code ${error.code})`)
  return !error
}

export async function touchMicrosoftIdentity(admin: Admin, owner: BindingOwner) {
  await admin.from('microsoft_identities').update({ last_sign_in_at: new Date().toISOString() })
    .eq(owner.kind === 'profile' ? 'profile_id' : 'member_id', owner.id)
}

// The exchanged Supabase session ends now, success or not (this session only, not the account's others)
export async function endExchangeSession(admin: Admin, accessToken: string) {
  const { error } = await admin.auth.admin.signOut(accessToken, 'local')
  if (error) console.error(`[microsoft] exchange session sign-out failed (${error.code ?? 'unknown'})`)
}

// After a refusal: an auth user Supabase created for this sign-in (no profile of ours) is deleted;
// an existing account keeps no Microsoft identity linked by a sign-in we refused.
export async function cleanUpAfterRefusal(admin: Admin, oauthUserId: string) {
  const { data: profile } = await admin.from('profiles').select('id').eq('id', oauthUserId).maybeSingle()
  if (!profile) {
    const { error } = await admin.auth.admin.deleteUser(oauthUserId)
    if (error) console.error(`[microsoft] stray auth user removal failed (${error.code ?? 'unknown'})`)
    return
  }
  const { error } = await admin.rpc('remove_microsoft_identities', { p_user_id: oauthUserId })
  if (error) console.error(`[microsoft] identity unlink failed (code ${error.code})`)
}

// The app's normal session for the matched account: a Supabase session written to the usual cookies
// (through a one-time server-side magic-link token that is never emailed), then the same signed
// 8-hour otp_session cookie a completed code step sets. Microsoft replaces the code step only. For a
// team member it is the region's shared account with the member in the signed cookie, exactly what
// the name picker produces.
export async function createAppSession(admin: Admin, profileId: string, memberId: string | null): Promise<User | null> {
  const { data: target } = await admin.auth.admin.getUserById(profileId)
  const email = target.user?.email
  if (!email) return null
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (linkError || !tokenHash) {
    console.error(`[microsoft] session token failed (${linkError?.code ?? 'none'})`)
    return null
  }
  const ssr = await createClient()
  const { data: verified, error: verifyError } = await ssr.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
  if (verifyError || !verified.user || verified.user.id !== profileId) {
    console.error(`[microsoft] session start failed (${verifyError?.code ?? 'mismatch'})`)
    if (verified?.user) await ssr.auth.signOut()
    return null
  }
  ;(await cookies()).set(OTP_SESSION_COOKIE, await signOtpSession(profileId, { memberId }), { ...cookieFlags, path: '/', maxAge: OTP_SESSION_MAX_AGE })
  return verified.user
}

// sign_in_events (every attempt, with the team member when there is one) and, when an account was
// matched, an audit_log row on it. Fixed text and reason codes only.
export async function recordMicrosoftAttempt(admin: Admin, event: MicrosoftEvent) {
  const reason = event.outcome === 'success' ? null : event.reason
  const { error } = await admin.from('sign_in_events').insert({
    method: 'microsoft', outcome: event.outcome, reason, user_id: event.userId, member_id: event.memberId,
  })
  if (error) console.error(`[microsoft] event insert failed (code ${error.code})`)
  if (!event.userId) return
  const message = event.outcome === 'success'
    ? microsoftAuditMessage(event.memberId ? 'success_member' : 'success')
    : event.outcome === 'note' ? microsoftAuditMessage(STAFF_OVER_MEMBER) : microsoftAuditMessage(event.reason)
  const actionType = event.outcome === 'success' ? 'navy'
    : event.outcome === 'refused' && event.reason === 'id_mismatch' ? 'red' : 'amber'
  const { error: auditError } = await admin.from('audit_log').insert({
    user_id: event.userId, performed_by: event.userId, action_type: actionType, message,
  })
  if (auditError) console.error(`[microsoft] audit insert failed (code ${auditError.code})`)
}
