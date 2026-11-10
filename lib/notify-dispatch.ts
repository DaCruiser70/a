import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, NotificationOutboxRow } from '@/types'
import { createServiceClient } from '@/lib/supabase/server'
import { sendNotice, mailerCanDeliver, type NoticeHooks, type NoticeMessage, type NoticeResult } from '@/lib/mailer'
import { noticeEmail, reminderEmail } from '@/lib/email-templates'
import { DailyReminderPayloadSchema, TARGET_AUDIENCE, type ReminderTarget } from '@/lib/reminder-payload'
import { loadReminderView } from '@/lib/reminders-render'
import {
  TEMPLATE_DEFS, AUDIENCES, AUDIENCE_LABELS, FLAG_SECTION_LABELS, linkPath, isNotificationTemplate,
  type Audience, type FlagSection, type NotificationTemplate,
} from '@/lib/notification-templates'
import { parsePayload, hrNotifyEmails, parseEmails } from '@/lib/notify'
import { linkBase, loadRecipient, readableDate } from '@/lib/password-setup'
import { activeRegionMembers } from '@/lib/pm-server'
import { isRegion } from '@/lib/pm'
import { VEHICLE_STEP_EMAILS, EQUIPMENT_LABELS } from '@/lib/stakeholder-mapping'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { hmacHex } from '@/lib/auth-secrets'

// Server only. Sends queued notifications, each at most once:
//   1. claim_notifications() claims a small batch (FOR UPDATE SKIP LOCKED; rows stuck in 'sending'
//      for over 10 minutes go back to 'queued' first), so two runs never hold the same row
//   2. recipients are looked up now, from the template's audience (never from the row)
//   3. the email is rendered and sent through lib/mailer.ts (EMAIL_MODE decides where it goes)
//   4. sent → 'sent'; a failure → fail_notification() (attempts + 1, error code, backoff 1 min,
//      5 min, 30 min, 2 h; 'dead' after 5); a send cap → back to 'queued' for later, not failed
// Never logged or stored: addresses, names, subjects, bodies, provider responses.

type Admin = SupabaseClient<Database>

export type Recipient = { email: string; audience: Audience }

export type DispatchDeps = {
  admin?:   Admin
  send?:    (msg: NoticeMessage, hooks: NoticeHooks) => Promise<NoticeResult>   // tests replace the mailer
  resolve?: (admin: Admin, row: NotificationOutboxRow, template: NotificationTemplate) => Promise<Recipient[]>
}
export type DispatchOptions = { limit?: number; onlyIds?: string[]; deps?: DispatchDeps }
export type DispatchSummary = {
  claimed: number; sent: number; failed: number; dead: number; deferred: number; released: number
  skipped: 'email_off' | null
}

// The sender mailbox: Exchange Online accepts about 30 messages a minute. Each recipient mailbox:
// at most 20 notices per 15 minutes (its own budget, separate from sign-in codes).
const SENDER_MAX       = 30
const SENDER_WINDOW    = 60
const RECIPIENT_MAX    = 20
const RECIPIENT_WINDOW = 15 * 60
const MAX_BATCH        = 50

class LookupError extends Error {}

// ── Recipients ──

async function activeAccounts(admin: Admin, role: string, ids: string[] | null = null) {
  const { data, error } = await admin.rpc('notify_active_accounts', { p_role: role, p_ids: ids })
  if (error) {
    console.error(`[notify-dispatch] account lookup failed (code ${error.code})`)
    throw new LookupError()
  }
  return data ?? []
}

async function resolveAudience(admin: Admin, audience: Audience, row: NotificationOutboxRow, payload: Record<string, unknown>): Promise<string[]> {
  switch (audience) {
    case 'hr':
      return hrNotifyEmails()
    case 'hire': {
      if (!row.newhire_id) return []
      if ((await activeAccounts(admin, 'newhire', [row.newhire_id])).length === 0) return []
      const r = await loadRecipient(admin, row.newhire_id)   // newhire-only accounts; personal email if given
      return r ? [r.to] : []
    }
    case 'payroll':
    case 'clearance':
      return (await activeAccounts(admin, audience)).map(a => a.email)
    case 'manager': {
      const managerId = typeof payload.managerId === 'string' ? payload.managerId : null
      if (!managerId) return []
      const { data: m, error } = await admin.from('managers').select('email, user_id, active').eq('id', managerId).maybeSingle()
      if (error) throw new LookupError()
      if (!m?.active || !m.user_id) return []
      return (await activeAccounts(admin, 'manager', [m.user_id])).length ? [m.email] : []
    }
    case 'pm_region':
      return isRegion(payload.region) ? (await activeRegionMembers(admin, payload.region)).map(m => m.member_email) : []
    case 'stakeholder': {
      const assigneeId = typeof payload.assigneeId === 'string' ? payload.assigneeId : null
      return assigneeId ? (await activeAccounts(admin, 'stakeholder', [assigneeId])).map(a => a.email) : []
    }
    case 'vehicle_rob':
    case 'vehicle_heather':
    case 'vehicle_marley': {
      const stepEmail = VEHICLE_STEP_EMAILS[audience === 'vehicle_rob' ? 'rob' : audience === 'vehicle_heather' ? 'heather' : 'marley']
      return (await activeAccounts(admin, 'stakeholder')).filter(a => a.email.toLowerCase() === stepEmail).map(a => a.email)
    }
  }
}

// A daily reminder's mailbox key: an HMAC of the address, so rows can be grouped by person without
// storing the address
export async function personKey(email: string): Promise<string> {
  return (await hmacHex('notify-person', email.trim().toLowerCase())).slice(0, 32)
}

// One daily-reminder target, with the same active and role checks as every other notice. A project
// management member must still be active and in the region named on the target.
export async function resolveTarget(admin: Admin, target: ReminderTarget): Promise<string[]> {
  switch (target.kind) {
    case 'hire': {
      if ((await activeAccounts(admin, 'newhire', [target.id])).length === 0) return []
      const r = await loadRecipient(admin, target.id)
      return r ? [r.to] : []
    }
    case 'stakeholder':
    case 'payroll':
      return (await activeAccounts(admin, target.kind, [target.id])).map(a => a.email)
    case 'manager': {
      const { data: m, error } = await admin.from('managers').select('email, user_id, active').eq('id', target.id).maybeSingle()
      if (error) throw new LookupError()
      if (!m?.active || !m.user_id) return []
      return (await activeAccounts(admin, 'manager', [m.user_id])).length ? [m.email] : []
    }
    case 'pm_member': {
      const { data: m, error } = await admin.from('region_teams').select('member_email')
        .eq('id', target.id).eq('region', target.region).eq('active', true).maybeSingle()
      if (error) throw new LookupError()
      return m ? [m.member_email] : []
    }
    case 'hr': {
      const out: string[] = []
      for (const email of hrNotifyEmails()) if (await personKey(email) === target.h) out.push(email)
      return out
    }
  }
}

export async function resolveRecipients(admin: Admin, row: NotificationOutboxRow, template: NotificationTemplate): Promise<Recipient[]> {
  const payload = (parsePayload(template, row.payload) ?? {}) as Record<string, unknown>
  const out: Recipient[] = []
  if (template === 'daily_reminder') {
    const parsed = DailyReminderPayloadSchema.safeParse(row.payload)
    if (!parsed.success) return []
    for (const target of parsed.data.to) {
      for (const email of await resolveTarget(admin, target)) out.push({ email, audience: TARGET_AUDIENCE[target.kind] })
    }
    return out
  }
  for (const audience of TEMPLATE_DEFS[template].audience) {
    for (const email of await resolveAudience(admin, audience, row, payload)) out.push({ email, audience })
  }
  return out
}

// One email per person per notice: addresses are merged case-insensitively, whatever audiences
// they came through (someone who is both payroll and HR gets one). Labels: the audiences that
// reached anyone, in a fixed order.
export function mergeRecipients(list: Recipient[]): { emails: string[]; labels: string[] } {
  const emails = parseEmails(list.map(r => r.email))
  const valid  = new Set(emails)
  const reached = new Set(list.filter(r => valid.has(r.email.trim().toLowerCase())).map(r => r.audience))
  return { emails, labels: AUDIENCES.filter(a => reached.has(a)).map(a => AUDIENCE_LABELS[a]) }
}

// ── Content ──

// null: a daily reminder whose items have all been dealt with since it was queued
async function renderNotice(admin: Admin, row: NotificationOutboxRow, template: NotificationTemplate, base: string) {
  if (template === 'daily_reminder') {
    const parsed = DailyReminderPayloadSchema.safeParse(row.payload)
    if (!parsed.success) return null
    const view = await loadReminderView(admin, parsed.data, base)
    return view ? reminderEmail(view) : null
  }
  const payload = (parsePayload(template, row.payload) ?? {}) as Record<string, unknown>
  const { data: hire } = row.newhire_id
    ? await admin.from('profiles').select('full_name, preferred_name, start_date').eq('id', row.newhire_id).maybeSingle()
    : { data: null }
  const fullName = hire?.full_name?.trim() ?? ''
  return noticeEmail(template, {
    hireName:  fullName,
    firstName: hire?.preferred_name?.trim() || fullName.split(/\s+/)[0] || '',
    startDate: hire?.start_date ? readableDate(hire.start_date) : null,
    section:   template === 'item_flagged' ? FLAG_SECTION_LABELS[payload.section as FlagSection] ?? null : null,
    taskNames: template === 'stakeholder_tasks_created' && Array.isArray(payload.taskKeys)
      ? (payload.taskKeys as string[]).map(k => EQUIPMENT_LABELS[k]).filter((n): n is string => !!n)
      : [],
    link: `${base}${linkPath(TEMPLATE_DEFS[template].link, row.newhire_id)}`,
  })
}

// ── Row outcomes (each a single conditional statement on a row this run holds) ──

async function markSent(admin: Admin, id: string) {
  const now = new Date().toISOString()
  const { error } = await admin.from('notification_outbox')
    .update({ status: 'sent', sent_at: now, claimed_at: null, last_error: null, updated_at: now })
    .eq('id', id).eq('status', 'sending')
  if (error) console.error(`[notify-dispatch] mark sent failed (code ${error.code})`)
}

async function markFailed(admin: Admin, id: string, code: string): Promise<'failed' | 'dead'> {
  const { data, error } = await admin.rpc('fail_notification', { p_id: id, p_code: code })
  if (error) console.error(`[notify-dispatch] mark failed failed (code ${error.code})`)
  return data === 'dead' ? 'dead' : 'failed'
}

// Back to 'queued' without using an attempt (send cap, email switched off mid-run, run stopped)
async function release(admin: Admin, id: string, delaySeconds = 0) {
  const now = new Date()
  const { error } = await admin.from('notification_outbox')
    .update({
      status: 'queued', claimed_at: null, updated_at: now.toISOString(),
      ...(delaySeconds > 0 ? { send_after: new Date(now.getTime() + delaySeconds * 1000).toISOString() } : {}),
    })
    .eq('id', id).eq('status', 'sending')
  if (error) console.error(`[notify-dispatch] release failed (code ${error.code})`)
}

type RowOutcome = 'sent' | 'failed' | 'dead' | 'deferred' | 'released'

async function processRow(admin: Admin, row: NotificationOutboxRow, deps: Required<Pick<DispatchDeps, 'send' | 'resolve'>>):
  Promise<{ outcome: RowOutcome; stopRun: boolean }> {
  if (!isNotificationTemplate(row.template)) return { outcome: await markFailed(admin, row.id, 'unknown_template'), stopRun: false }
  const template = row.template
  if (!parsePayload(template, row.payload)) return { outcome: await markFailed(admin, row.id, 'bad_payload'), stopRun: false }

  let recipients: Recipient[]
  try {
    recipients = await deps.resolve(admin, row, template)
  } catch {
    return { outcome: await markFailed(admin, row.id, 'lookup_failed'), stopRun: false }
  }
  const { emails, labels } = mergeRecipients(recipients)
  if (emails.length === 0) return { outcome: await markFailed(admin, row.id, 'no_recipients'), stopRun: false }
  // A daily reminder is one person's merged email: if its targets no longer lead to exactly one
  // address, nobody gets someone else's list
  if (template === 'daily_reminder' && emails.length !== 1) {
    return { outcome: await markFailed(admin, row.id, 'recipient_changed'), stopRun: false }
  }

  const base = linkBase()
  if (!base) return { outcome: await markFailed(admin, row.id, 'no_app_url'), stopRun: false }
  const content = await renderNotice(admin, row, template, base)
  if (!content) {
    await markSent(admin, row.id)   // nothing left to remind about: done, nothing sent
    return { outcome: 'sent', stopRun: false }
  }

  // Delivered addresses are kept as HMACs bound to this row, so a retry skips them
  const delivered = new Set(row.delivered ?? [])
  const mark = (to: string) => hmacHex('notify-delivered', `${row.id}:${to.toLowerCase()}`)
  let senderCapHit = false

  const result = await deps.send({ recipients: emails, audienceLabels: labels, ...content }, {
    isDone: async to => delivered.has(await mark(to)),
    beforeSend: async to => {
      const sender = await rateLimit('mail:notify-sender', SENDER_MAX, SENDER_WINDOW)
      if (!sender.allowed) { senderCapHit = true; return { ok: false, retryAfterSeconds: sender.retryAfterSeconds } }
      const mailbox = await rateLimit(await rateLimitKey('mail:notify-recipient', to.toLowerCase()), RECIPIENT_MAX, RECIPIENT_WINDOW)
      return mailbox.allowed ? { ok: true } : { ok: false, retryAfterSeconds: mailbox.retryAfterSeconds }
    },
    afterSend: async to => {
      delivered.add(await mark(to))
      const { error } = await admin.from('notification_outbox')
        .update({ delivered: [...delivered], updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', 'sending')
      if (error) console.error(`[notify-dispatch] delivery record failed (code ${error.code})`)
    },
  })

  switch (result.outcome) {
    case 'sent':
      await markSent(admin, row.id)
      return { outcome: 'sent', stopRun: false }
    case 'deferred':
      await release(admin, row.id, result.retryAfterSeconds)
      return { outcome: 'deferred', stopRun: senderCapHit }
    case 'failed':
      return { outcome: await markFailed(admin, row.id, result.error), stopRun: false }
    case 'invalid':
      return { outcome: await markFailed(admin, row.id, 'invalid'), stopRun: false }
    case 'logged':
    case 'not_configured':
      // Email was switched off during the run: leave it queued, never failed
      await release(admin, row.id)
      return { outcome: 'released', stopRun: true }
  }
}

// Runs one batch. Never throws. With onlyIds, only those rows are considered (HR's Send now, a
// kick right after enqueueing, and the test script).
export async function dispatchNotifications(opts: DispatchOptions = {}): Promise<DispatchSummary> {
  const summary: DispatchSummary = { claimed: 0, sent: 0, failed: 0, dead: 0, deferred: 0, released: 0, skipped: null }
  const send    = opts.deps?.send ?? sendNotice
  const resolve = opts.deps?.resolve ?? resolveRecipients

  // Console mode, or settings missing (EMAIL_MODE unset in production): nothing is claimed, so
  // every row stays queued until email is switched on
  if (!opts.deps?.send && !mailerCanDeliver()) {
    console.log('[notify-dispatch] email is off (console mode or not configured); nothing claimed')
    return { ...summary, skipped: 'email_off' }
  }
  if (opts.onlyIds && opts.onlyIds.length === 0) return summary

  try {
    const admin = opts.deps?.admin ?? createServiceClient()
    const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 10), 1), MAX_BATCH)
    const { data: rows, error } = await admin.rpc('claim_notifications', { p_limit: limit, p_only_ids: opts.onlyIds ?? null })
    if (error) {
      console.error(`[notify-dispatch] claim failed (code ${error.code})`)
      return summary
    }
    summary.claimed = rows?.length ?? 0

    let stop = false
    for (const row of rows ?? []) {
      if (stop) {
        await release(admin, row.id)
        summary.released++
        continue
      }
      let result: { outcome: RowOutcome; stopRun: boolean }
      try {
        result = await processRow(admin, row, { send, resolve })
      } catch {
        result = { outcome: await markFailed(admin, row.id, 'unknown'), stopRun: false }
      }
      summary[result.outcome]++
      stop = result.stopRun
    }
  } catch {
    console.error('[notify-dispatch] run failed')
  }

  if (summary.claimed > 0) {
    console.log(`[notify-dispatch] claimed ${summary.claimed}: sent ${summary.sent}, failed ${summary.failed}, dead ${summary.dead}, deferred ${summary.deferred}, released ${summary.released}`)
  }
  return summary
}
