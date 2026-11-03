import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'
import { send, mailerCanDeliver } from '@/lib/mailer'
import { signInCodeEmail, revealCodeEmail } from '@/lib/email-templates'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'

// Server only. Emails a one-time code (sign-in or reveal) to the person's own address.
// Never logs the code or the address; the outbox is never involved.

// Per recipient: at most 5 code emails per 15 minutes, whatever route asked for them
const RECIPIENT_MAX    = 5
const RECIPIENT_WINDOW = 15 * 60

// Generic message for every delivery failure
export const CODE_SEND_FAILED = 'We couldn’t send your code. Please try again in a minute.'

// Development echo of a code to the browser: only with ALLOW_DEV_OTP=true, never in production
export function devOtpEnabled(): boolean {
  return process.env.ALLOW_DEV_OTP === 'true' && process.env.NODE_ENV !== 'production'
}

// A code can reach the person: a real email (test or live mode), or the development echo
export function codeDeliveryPossible(): boolean {
  return mailerCanDeliver() || devOtpEnabled()
}

type CodeEmail =
  | { kind: 'sign_in'; code: string; ttlSeconds: number }
  | { kind: 'reveal'; code: string; ttlSeconds: number; recordType: string }

// Returns true when the person can use the code: the email was sent, or (console mode in
// development) the development echo shows it. Audits one row per attempt: category and user only.
export async function deliverCode(
  admin: SupabaseClient<Database>, userId: string, to: string, email: CodeEmail,
): Promise<boolean> {
  const category = email.kind === 'sign_in' ? 'login_code' : 'reveal_code'
  const label    = email.kind === 'sign_in' ? 'Sign-in code' : 'Reveal code'

  const cap = await rateLimit(await rateLimitKey('mail:code-recipient', to.trim().toLowerCase()), RECIPIENT_MAX, RECIPIENT_WINDOW)
  if (!cap.allowed) {
    await audit(admin, userId, `${label} email not sent (too many codes for this mailbox)`, 'red')
    return false
  }

  const content = email.kind === 'sign_in'
    ? signInCodeEmail(email.code, email.ttlSeconds)
    : revealCodeEmail(email.code, email.ttlSeconds, email.recordType)

  // Codes never stay in the sender's Sent Items
  const result = await send({ to, ...content, category, saveToSentItems: false })

  if (result.status === 'sent') {
    await audit(admin, userId, `${label} email sent`, 'navy')
    return true
  }
  if (result.status === 'logged') {
    await audit(admin, userId, `${label} email not sent (console mode)`, 'amber')
    return devOtpEnabled()
  }
  await audit(admin, userId, `${label} email could not be sent`, 'red')
  return false
}

async function audit(admin: SupabaseClient<Database>, userId: string, message: string, actionType: 'navy' | 'amber' | 'red') {
  const { error } = await admin.from('audit_log').insert({ user_id: userId, action_type: actionType, message, performed_by: userId })
  if (error) console.error(`[code-delivery] audit insert failed (code ${error.code})`)
}
