import { randomUUID } from 'node:crypto'
import { z } from 'zod'

// Server only. The one email sender: every email in the app goes through send().
//
// EMAIL_MODE
//   console  nothing is sent; only the category and a local message id are logged
//   test     every email goes to EMAIL_TEST_RECIPIENT, subject prefixed with the masked real recipient
//   live     the real recipient
// Fails closed: a missing or invalid EMAIL_MODE in production, or missing Graph settings in test or
// live, refuses to send. Outside production a missing EMAIL_MODE means console.
//
// Delivery is Microsoft Graph (client credentials, POST /users/{MAIL_SENDER}/sendMail).
// Never logged: recipients, subjects, bodies, tokens, response bodies.

export type MailMode     = 'console' | 'test' | 'live'
export type MailCategory = 'login_code' | 'reveal_code' | 'welcome' | 'password_reset' | 'test'
export type MailStatus   = 'sent' | 'logged' | 'not_configured' | 'invalid' | 'failed'
export type SendResult   = { ok: boolean; status: MailStatus }

type ErrorCategory = 'auth_failed' | 'throttled' | 'rejected' | 'network'

const MessageSchema = z.strictObject({
  to:              z.string().trim().toLowerCase().max(254).pipe(z.email()),
  subject:         z.string().trim().min(1).max(200),
  html:            z.string().min(1).max(200_000),
  text:            z.string().min(1).max(100_000),
  category:        z.enum(['login_code', 'reveal_code', 'welcome', 'password_reset', 'test']),
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

  const url  = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`
  const body = JSON.stringify({
    message: {
      subject,
      body:         { contentType: 'HTML', content: msg.html },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: msg.saveToSentItems,
  })

  const result = await withRetries(() => fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': 'application/json' },
    body,
    signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }))

  if (result.ok) {
    logOutcome(msg.category, id, `sent (status ${result.status})`)
    return { ok: true, status: 'sent' }
  }
  if (result.status === 401) cachedToken = null   // a revoked or rotated secret: fetch a new token next time
  logOutcome(msg.category, id, `failed: ${result.error}${result.status ? ` (status ${result.status})` : ''}`)
  return { ok: false, status: 'failed' }
}

// ── Graph token (client credentials), cached until shortly before expiry ──

let cachedToken: { token: string; expiresAt: number; key: string } | null = null

async function getToken(config: Extract<MailConfig, { mode: 'test' | 'live'; ready: true }>):
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
