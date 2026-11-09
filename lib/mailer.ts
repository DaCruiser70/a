import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { esc } from '@/lib/safe-html'

// Server only. The one email sender: every email in the app goes through send() or sendNotice().
//
// EMAIL_MODE
//   console  nothing is sent; only the category and a local message id are logged
//   test     every email goes to EMAIL_TEST_RECIPIENT only: codes get "[TEST for j***@…]", notifications
//            "[TEST → HR, Payroll]" and a "Would have gone to:" first line (sendNotice)
//   live     the real recipient
// Fails closed: a missing or invalid EMAIL_MODE in production, or missing Graph settings in test or
// live, refuses to send. Outside production a missing EMAIL_MODE means console.
//
// Delivery is Microsoft Graph (client credentials, POST /users/{MAIL_SENDER}/sendMail).
// Never logged: recipients, subjects, bodies, tokens, response bodies.

export type MailMode     = 'console' | 'test' | 'live'
export type MailCategory = 'login_code' | 'reveal_code' | 'welcome' | 'password_reset' | 'test' | 'notification'
export type MailStatus   = 'sent' | 'logged' | 'not_configured' | 'invalid' | 'failed'
export type SendResult   = { ok: boolean; status: MailStatus }

export type ErrorCategory = 'auth_failed' | 'throttled' | 'rejected' | 'network'

const MessageSchema = z.strictObject({
  to:              z.string().trim().toLowerCase().max(254).pipe(z.email()),
  subject:         z.string().trim().min(1).max(200),
  html:            z.string().min(1).max(200_000),
  text:            z.string().min(1).max(100_000),
  category:        z.enum(['login_code', 'reveal_code', 'welcome', 'password_reset', 'test', 'notification']),
  saveToSentItems: z.boolean(),
})
export type MailMessage = z.input<typeof MessageSchema>

const REQUEST_TIMEOUT_MS = 10_000
const MAX_TRIES          = 3
const MAX_RETRY_WAIT_MS  = 5_000      // a longer Retry-After is treated as throttled, not waited out
const TOKEN_EARLY_MS     = 5 * 60_000 // refresh the token this long before it expires

// ── Configuration ──

type MailConfig =
  | { ready: true; mode: 'console' }
  | { ready: true; mode: 'test' | 'live'; tenant: string; clientId: string; secret: string; sender: string; testRecipient: string | null }
  | { ready: false; mode: MailMode | null }

const isEmail = (v: string | undefined): v is string => !!v && z.email().safeParse(v).success

export function mailConfig(): MailConfig {
  const raw  = process.env.EMAIL_MODE?.trim().toLowerCase()
  const prod = process.env.NODE_ENV === 'production'
  const mode: MailMode | null =
    raw === 'console' || raw === 'test' || raw === 'live' ? raw
    : !raw && !prod ? 'console'
    : null                                   // invalid anywhere, or missing in production
  if (!mode) return { ready: false, mode: null }
  if (mode === 'console') return { ready: true, mode }

  const tenant   = process.env.GRAPH_TENANT_ID?.trim()
  const clientId = process.env.GRAPH_CLIENT_ID?.trim()
  const secret   = process.env.GRAPH_CLIENT_SECRET?.trim()
  const sender   = process.env.MAIL_SENDER?.trim().toLowerCase()
  const testTo   = process.env.EMAIL_TEST_RECIPIENT?.trim().toLowerCase()
  if (!tenant || !clientId || !secret || !isEmail(sender)) return { ready: false, mode }
  if (mode === 'test' && !isEmail(testTo)) return { ready: false, mode }
  return { ready: true, mode, tenant, clientId, secret, sender, testRecipient: mode === 'test' ? testTo! : null }
}

// True when send() can actually deliver an email (test or live, fully configured)
export function mailerCanDeliver(): boolean {
  const c = mailConfig()
  return c.ready && c.mode !== 'console'
}

// j***@aemltd.com
export function maskRecipient(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return '***'
  return `${local[0]}***@${domain}`
}

function logOutcome(category: MailCategory, id: string, outcome: string): void {
  console.log(`[mailer] ${category} ${id} ${outcome}`)
}

// ── Send ──

export async function send(message: MailMessage): Promise<SendResult> {
  const parsed = MessageSchema.safeParse(message)
  const category: MailCategory = parsed.success ? parsed.data.category : 'test'
  const id = randomUUID()
  if (!parsed.success) {
    logOutcome(category, id, 'refused: invalid message')
    return { ok: false, status: 'invalid' }
  }
  const msg    = parsed.data
  const config = mailConfig()

  if (!config.ready) {
    logOutcome(msg.category, id, 'refused: email is not configured')
    return { ok: false, status: 'not_configured' }
  }
  if (config.mode === 'console') {
    logOutcome(msg.category, id, 'console mode, not sent')
    return { ok: true, status: 'logged' }
  }

  const to      = config.mode === 'test' ? config.testRecipient! : msg.to
  const subject = config.mode === 'test' ? `[TEST for ${maskRecipient(msg.to)}] ${msg.subject}` : msg.subject

  const token = await getToken(config)
  if (!token.ok) {
    logOutcome(msg.category, id, `failed: ${token.error}${token.status ? ` (status ${token.status})` : ''}`)
    return { ok: false, status: 'failed' }
  }

  const result = await postMail(config, token.token, graphMessage(to, subject, msg.html, msg.saveToSentItems))

  if (result.ok) {
    logOutcome(msg.category, id, `sent (status ${result.status})`)
    return { ok: true, status: 'sent' }
  }
  logOutcome(msg.category, id, `failed: ${result.error}${result.status ? ` (status ${result.status})` : ''}`)
  return { ok: false, status: 'failed' }
}

// The Graph sendMail body: exactly one To recipient. There is no cc, bcc or reply-to field, and
// nothing else in the app builds a Graph message.
export function graphMessage(to: string, subject: string, html: string, saveToSentItems: boolean) {
  return {
    message: {
      subject,
      body:         { contentType: 'HTML' as const, content: html },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems,
  }
}

async function postMail(config: ReadyGraphConfig, token: string, message: ReturnType<typeof graphMessage>): Promise<Attempt> {
  const url    = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`
  const result = await withRetries(() => fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(message),
    signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }))
  if (!result.ok && result.status === 401) cachedToken = null   // a revoked or rotated secret: fetch a new token next time
  return result
}

// ── Notifications (lib/notify-dispatch.ts) ──
//
// One notice, several real recipients:
//   live  one message per recipient, each to that recipient only
//   test  ONE message to EMAIL_TEST_RECIPIENT, subject "[TEST → HR, Manager] …", and the body starts
//         with "Would have gone to: <the real recipients>". No real address is ever a recipient.
//   console, or not configured: nothing is sent
// Never logged: recipients, subject, body.

const NoticeSchema = z.strictObject({
  recipients:     z.array(z.string().trim().toLowerCase().max(254).pipe(z.email())).min(1).max(100),
  audienceLabels: z.array(z.string().trim().min(1).max(40)).min(1).max(10),
  subject:        z.string().trim().min(1).max(160),
  html:           z.string().min(1).max(200_000),
  text:           z.string().min(1).max(100_000),
})
export type NoticeMessage  = z.input<typeof NoticeSchema>
export type NoticeDelivery = { to: string; subject: string; html: string; text: string }

// Per delivery address (the real recipient in live mode, the test mailbox in test mode):
//   isDone      already delivered by an earlier attempt: skip it
//   beforeSend  'defer' stops here and leaves the rest for later (a send cap)
//   afterSend   record the delivery
export type NoticeHooks = {
  isDone?:     (to: string) => Promise<boolean> | boolean
  beforeSend?: (to: string) => Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }>
  afterSend?:  (to: string) => Promise<void>
}
export type NoticeResult =
  | { outcome: 'sent' }
  | { outcome: 'logged' }                                  // console mode
  | { outcome: 'not_configured' }
  | { outcome: 'invalid' }
  | { outcome: 'deferred'; retryAfterSeconds: number }
  | { outcome: 'failed'; error: ErrorCategory }

// What would be posted, without sending. Pure, so the redirect can be tested.
export function planNotice(mode: 'test' | 'live', testRecipient: string | null, msg: NoticeMessage): NoticeDelivery[] {
  const m = NoticeSchema.parse(msg)
  if (mode === 'live') return m.recipients.map(to => ({ to, subject: m.subject, html: m.html, text: m.text }))
  if (!testRecipient || !isEmail(testRecipient)) return []

  const wouldHave = `Would have gone to: ${m.recipients.join(', ')}`
  const banner    = `<div style="padding:10px 14px;background:#FFF4D6;border-bottom:2px solid #C8920A;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#1a2e25;">${esc(wouldHave)}</div>`
  const bodyTag   = /<body[^>]*>/i
  return [{
    to:      testRecipient,
    subject: `[TEST → ${[...new Set(m.audienceLabels)].join(', ')}] ${m.subject}`,
    html:    bodyTag.test(m.html) ? m.html.replace(bodyTag, tag => `${tag}\n${banner}`) : `${banner}\n${m.html}`,
    text:    `${wouldHave}\n\n${m.text}`,
  }]
}

export async function sendNotice(msg: NoticeMessage, hooks: NoticeHooks = {}): Promise<NoticeResult> {
  const id     = randomUUID()
  const config = mailConfig()
  if (!NoticeSchema.safeParse(msg).success) {
    logOutcome('notification', id, 'refused: invalid message')
    return { outcome: 'invalid' }
  }
  if (!config.ready) {
    logOutcome('notification', id, 'refused: email is not configured')
    return { outcome: 'not_configured' }
  }
  if (config.mode === 'console') {
    logOutcome('notification', id, 'console mode, not sent')
    return { outcome: 'logged' }
  }

  const deliveries = planNotice(config.mode, config.testRecipient, msg)
  if (deliveries.length === 0) return { outcome: 'not_configured' }

  const token = await getToken(config)
  if (!token.ok) {
    logOutcome('notification', id, `failed: ${token.error}${token.status ? ` (status ${token.status})` : ''}`)
    return { outcome: 'failed', error: token.error }
  }

  let sent = 0
  for (const d of deliveries) {
    if (await hooks.isDone?.(d.to)) continue
    const gate = await hooks.beforeSend?.(d.to)
    if (gate && !gate.ok) {
      logOutcome('notification', id, `deferred after ${sent} of ${deliveries.length} (send cap)`)
      return { outcome: 'deferred', retryAfterSeconds: gate.retryAfterSeconds }
    }
    // Notices stay in the sender's Sent Items (no secrets in them)
    const result = await postMail(config, token.token, graphMessage(d.to, d.subject, d.html, true))
    if (!result.ok) {
      logOutcome('notification', id, `failed after ${sent} of ${deliveries.length}: ${result.error}${result.status ? ` (status ${result.status})` : ''}`)
      return { outcome: 'failed', error: result.error }
    }
    sent++
    await hooks.afterSend?.(d.to)
  }
  logOutcome('notification', id, `sent ${sent} of ${deliveries.length}`)
  return { outcome: 'sent' }
}


// ── Graph token (client credentials), cached until shortly before expiry ──

let cachedToken: { token: string; expiresAt: number; key: string } | null = null

type ReadyGraphConfig = Extract<MailConfig, { mode: 'test' | 'live'; ready: true }>

async function getToken(config: ReadyGraphConfig):
  Promise<{ ok: true; token: string } | { ok: false; error: ErrorCategory; status?: number }> {
  const key = `${config.tenant}:${config.clientId}`
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt - TOKEN_EARLY_MS > Date.now()) {
    return { ok: true, token: cachedToken.token }
  }

  const form = new URLSearchParams({
    client_id:     config.clientId,
    client_secret: config.secret,
    scope:         'https://graph.microsoft.com/.default',
    grant_type:    'client_credentials',
  })
  const result = await withRetries(() => fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
  ))
  if (!result.ok) {
    // Bad tenant, client id or secret come back as 400/401
    const error = result.error === 'rejected' ? 'auth_failed' : result.error
    return { ok: false, error, status: result.status }
  }

  try {
    const json = await result.response.json() as { access_token?: unknown; expires_in?: unknown }
    if (typeof json.access_token !== 'string') return { ok: false, error: 'auth_failed' }
    const seconds = typeof json.expires_in === 'number' ? json.expires_in : 3600
    cachedToken = { token: json.access_token, expiresAt: Date.now() + seconds * 1000, key }
    return { ok: true, token: json.access_token }
  } catch {
    return { ok: false, error: 'auth_failed' }
  }
}

// ── Retries: 429 and 5xx, honouring Retry-After, at most MAX_TRIES attempts ──

type Attempt =
  | { ok: true; status: number; response: Response }
  | { ok: false; status?: number; error: ErrorCategory }

async function withRetries(request: () => Promise<Response>): Promise<Attempt> {
  let last: Attempt = { ok: false, error: 'network' }
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    let res: Response
    try {
      res = await request()
    } catch {
      return { ok: false, error: 'network' }   // a timeout may still have been delivered: never resend
    }
    if (res.ok) return { ok: true, status: res.status, response: res }

    // The body is drained, never read into a log
    await res.body?.cancel().catch(() => {})
    const retryable = res.status === 429 || res.status >= 500
    last = {
      ok: false, status: res.status,
      error: res.status === 401 || res.status === 403 ? 'auth_failed' : res.status === 429 ? 'throttled' : retryable ? 'network' : 'rejected',
    }
    if (!retryable || attempt === MAX_TRIES) break

    const wait = retryAfterMs(res.headers.get('retry-after')) ?? attempt * 1000
    if (wait > MAX_RETRY_WAIT_MS) break
    await new Promise(r => setTimeout(r, wait))
  }
  return last
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const at = Date.parse(header)
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now())
}
