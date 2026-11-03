import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, PasswordSetupToken } from '@/types'
import { decrypt, isEncrypted } from '@/lib/encrypt'
import { send, maskRecipient } from '@/lib/mailer'
import { welcomeEmail, passwordResetEmail } from '@/lib/email-templates'

// Server only. One-time "set your password" links for new hires (welcome and reset).
// The token is 32 random bytes, URL-safe; only its SHA-256 is stored (password_setup_tokens).
// Never logged: tokens, links, hashes, addresses, passwords.

type Admin = SupabaseClient<Database>

export type LinkPurpose = 'welcome' | 'reset'

export const PASSWORD_LINK_TTL_SECONDS = 72 * 3600
export const SET_PASSWORD_PATH         = '/set-password'

// The one message for an invalid, expired or used link: never says which
export const LINK_INVALID = 'This link has expired or was already used.'

// What base64url of 32 bytes looks like (no padding)
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

// The audit message that marks a password as set (also how HR's page knows it, after the token
// row itself is cleaned up)
export const PASSWORD_SET_AUDIT_PREFIX = 'Password set using'

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

// Constant-time comparison of two SHA-256 hex digests
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === 32 && y.length === 32 && timingSafeEqual(x, y)
}

// Links are built from NEXT_PUBLIC_APP_URL only, never from request headers. Production needs an
// https URL; without one nothing is sent. Outside production an unset value means localhost.
export function linkBase(): string | null {
  const raw  = process.env.NEXT_PUBLIC_APP_URL?.trim()
  const prod = process.env.NODE_ENV === 'production'
  if (!raw) return prod ? null : 'http://localhost:3000'
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:' && (prod || url.protocol !== 'http:')) return null
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

// Newhire-only accounts: one role, 'newhire'. Staff never use this flow.
export function isNewhireAccount(p: { role: string; roles: string[] | null }): boolean {
  return p.role === 'newhire' && Array.isArray(p.roles) && p.roles.length === 1 && p.roles[0] === 'newhire'
}

type Recipient = { to: string; firstName: string; startDate: string | null; office: string | null }

// The personal email when HR gave one, otherwise the login email. Null for anything but a newhire.
async function loadRecipient(admin: Admin, userId: string): Promise<Recipient | null> {
  const { data: p } = await admin
    .from('profiles')
    .select('full_name, preferred_name, aem_email, contact_email, start_date, office_location, role, roles')
    .eq('id', userId)
    .maybeSingle()
  if (!p || !isNewhireAccount(p)) return null
  return {
    to:        contactEmail(p.contact_email) ?? p.aem_email,
    firstName: p.preferred_name?.trim() || p.full_name.trim().split(/\s+/)[0] || '',
    startDate: p.start_date ? readableDate(p.start_date) : null,
    office:    p.office_location ?? null,
  }
}

// 2026-11-02 → "Monday, November 2, 2026" (a calendar date, so no time zone shift)
function readableDate(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function contactEmail(ciphertext: string | null): string | null {
  if (!isEncrypted(ciphertext)) return null
  try {
    return decrypt(ciphertext)
  } catch {
    console.error('[password-link] contact email could not be decrypted')
    return null
  }
}

// j***@gmail.com for the address a link goes to now (HR's page and the Add New Hire modal)
export async function maskedLinkRecipient(admin: Admin, userId: string): Promise<string | null> {
  const r = await loadRecipient(admin, userId)
  return r ? maskRecipient(r.to) : null
}

export type LinkSendResult =
  | { outcome: 'sent';     maskedTo: string }
  | { outcome: 'not_sent'; maskedTo: string | null }   // email off, failed, or no https app URL
  | { outcome: 'refused' }                              // not a newhire account, or the issue was refused

// Issues a fresh token (earlier unused ones stop working in the same statement) and emails the
// link. Audits one row: the purpose and the user only. createdBy: the HR user, or null.
export async function sendPasswordLink(
  admin: Admin, userId: string, purpose: LinkPurpose, createdBy: string | null,
): Promise<LinkSendResult> {
  const label     = purpose === 'welcome' ? 'Welcome email' : 'Password reset email'
  const recipient = await loadRecipient(admin, userId)
  if (!recipient) return { outcome: 'refused' }
  const maskedTo  = maskRecipient(recipient.to)

  const base = linkBase()
  if (!base) {
    console.error('[password-link] refused: NEXT_PUBLIC_APP_URL is missing or not https')
    await audit(admin, userId, createdBy, `${label} not sent (the portal address is not set up)`, 'red')
    return { outcome: 'not_sent', maskedTo }
  }

  const token = randomBytes(32).toString('base64url')
  const { data: tokenId, error } = await admin.rpc('issue_password_token', {
    p_user_id:     userId,
    p_token_hash:  hashToken(token),
    p_purpose:     purpose,
    p_ttl_seconds: PASSWORD_LINK_TTL_SECONDS,
    p_created_by:  createdBy,
  })
  if (error || !tokenId) {
    if (error) console.error(`[password-link] issue failed (code ${error.code})`)
    return { outcome: 'refused' }
  }

  // The token rides in the fragment, so it never reaches a server log or a Referer header
  const link    = `${base}${SET_PASSWORD_PATH}#token=${token}`
  const content = purpose === 'welcome'
    ? welcomeEmail({ firstName: recipient.firstName, startDate: recipient.startDate, office: recipient.office, link, ttlSeconds: PASSWORD_LINK_TTL_SECONDS })
    : passwordResetEmail({ firstName: recipient.firstName, link, ttlSeconds: PASSWORD_LINK_TTL_SECONDS })

  // The link is a credential: it never stays in the sender's Sent Items
  const result = await send({
    to: recipient.to, ...content,
    category: purpose === 'welcome' ? 'welcome' : 'password_reset',
    saveToSentItems: false,
  })

  if (result.status === 'sent') {
    await markToken(admin, tokenId, { delivery_status: 'sent', sent_at: new Date().toISOString() })
    await audit(admin, userId, createdBy, `${label} sent`, 'navy')
    return { outcome: 'sent', maskedTo }
  }

  // Nobody has this link: end it now
  const now = new Date().toISOString()
  if (result.status === 'logged') {
    await markToken(admin, tokenId, { delivery_status: 'pending', expires_at: now })
    await audit(admin, userId, createdBy, `${label} not sent (console mode)`, 'amber')
  } else {
    await markToken(admin, tokenId, { delivery_status: 'failed', expires_at: now })
    await audit(admin, userId, createdBy, `${label} could not be sent`, 'red')
  }
  return { outcome: 'not_sent', maskedTo }
}

async function markToken(admin: Admin, id: string, update: Database['public']['Tables']['password_setup_tokens']['Update']) {
  const { error } = await admin.from('password_setup_tokens').update(update).eq('id', id)
  if (error) console.error(`[password-link] token update failed (code ${error.code})`)
}

export async function audit(
  admin: Admin, userId: string, performedBy: string | null, message: string, actionType: 'navy' | 'amber' | 'red' | 'green',
) {
  const { error } = await admin.from('audit_log').insert({ user_id: userId, action_type: actionType, message, performed_by: performedBy ?? userId })
  if (error) console.error(`[password-link] audit insert failed (code ${error.code})`)
}

// ── HR view ──

export type LinkState = 'waiting' | 'password_set' | 'expired' | 'not_sent' | 'none'

export type PasswordLinkStatus = {
  state:       LinkState
  passwordSet: boolean
  purpose:     LinkPurpose | null
  delivery:    PasswordSetupToken['delivery_status'] | null
  sentAt:      string | null
  createdAt:   string | null
  expiresAt:   string | null
  to:          string | null   // masked
}

// The newest link and whether a password was ever set through one. Values only: no token or hash.
export async function passwordLinkStatus(admin: Admin, userId: string): Promise<PasswordLinkStatus> {
  const [{ data: latest }, { count: usedCount }, { count: setAudits }, to] = await Promise.all([
    admin.from('password_setup_tokens')
      .select('purpose, used_at, expires_at, created_at, delivery_status, sent_at')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('password_setup_tokens').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).not('used_at', 'is', null),
    admin.from('audit_log').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).like('message', `${PASSWORD_SET_AUDIT_PREFIX}%`),
    maskedLinkRecipient(admin, userId),
  ])
  const passwordSet = (usedCount ?? 0) > 0 || (setAudits ?? 0) > 0

  let state: LinkState
  if (!latest)                                     state = passwordSet ? 'password_set' : 'none'
  else if (latest.used_at)                         state = 'password_set'
  else if (latest.delivery_status !== 'sent')      state = 'not_sent'
  else if (new Date(latest.expires_at) <= new Date()) state = passwordSet ? 'password_set' : 'expired'
  else                                             state = 'waiting'

  return {
    state,
    passwordSet,
    purpose:   latest?.purpose ?? null,
    delivery:  latest?.delivery_status ?? null,
    sentAt:    latest?.sent_at ?? null,
    createdAt: latest?.created_at ?? null,
    expiresAt: latest?.expires_at ?? null,
    to,
  }
}
