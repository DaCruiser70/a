import { after } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { REGIONS } from '@/lib/regions'
import {
  TEMPLATE_DEFS, FLAG_SECTIONS, type NotificationTemplate,
} from '@/lib/notification-templates'
import { DailyReminderPayloadSchema, TARGET_AUDIENCE, type DailyReminderPayload } from '@/lib/reminder-payload'

// Notification outbox. queueNotification() records one row in notification_outbox; the dispatcher
// (lib/notify-dispatch.ts) sends it. A row never holds an address: recipients come from the
// template's audience and are looked up at send time.
//
// Payloads carry ids and fixed values only (a manager id, a region, a section key), never names,
// addresses, links or anything sensitive. They are validated again before every send.

export {
  NOTIFICATION_TEMPLATES, TEMPLATE_LABELS, TEMPLATE_DEFS, type NotificationTemplate,
} from '@/lib/notification-templates'

const Empty = z.strictObject({})
export const PAYLOAD_SCHEMAS = {
  manager_plan_requested:     z.strictObject({ managerId: z.uuid() }),
  manager_plan_submitted:     Empty,
  clearance_unlocked:         Empty,
  clearance_submitted:        Empty,
  onboarding_complete:        Empty,
  pm_request_created:         z.strictObject({ region: z.enum(REGIONS) }),
  pm_request_done:            Empty,
  clearance_package_sent:     Empty,
  clearance_package_returned: Empty,
  clearance_package_done:     Empty,
  vehicle_rob_task:           Empty,
  vehicle_heather_task:       Empty,
  vehicle_license_review:     Empty,
  vehicle_insurance_task:     Empty,
  vehicle_complete:           Empty,
  item_flagged:               z.strictObject({ section: z.enum(FLAG_SECTIONS) }),
  hire_approved:              Empty,
  hire_all_set:               Empty,
  payroll_done:               Empty,
  stakeholder_tasks_created:  z.strictObject({ assigneeId: z.uuid(), taskKeys: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).min(1).max(20) }),
  daily_reminder:             DailyReminderPayloadSchema,
} satisfies Record<NotificationTemplate, z.ZodType>

export type NotificationPayload<T extends NotificationTemplate> = z.infer<typeof PAYLOAD_SCHEMAS[T]>

// Legacy rows written before 20261103 kept a few extra keys; the dispatcher reads only these
export function parsePayload<T extends NotificationTemplate>(template: T, raw: unknown): NotificationPayload<T> | null {
  const keys = Object.keys(PAYLOAD_SCHEMAS[template].shape)
  const picked = raw && typeof raw === 'object'
    ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k]) => keys.includes(k)))
    : {}
  const parsed = PAYLOAD_SCHEMAS[template].safeParse(picked)
  return parsed.success ? (parsed.data as NotificationPayload<T>) : null
}

export function hrNotifyEmails(): string[] {
  return parseEmails(process.env.HR_NOTIFY_EMAILS || 'hr@aemltd.com')
}

export function parseEmails(value: string | string[]): string[] {
  const list = Array.isArray(value) ? value : value.split(',')
  return [...new Set(
    list.map(e => e.trim().toLowerCase()).filter(e => e.length <= 254 && z.email().safeParse(e).success)
  )]
}

// The recipient part of the dedupe key: the audience, plus the one person or region it targets
function audienceKey(template: NotificationTemplate, payload: Record<string, unknown>): string {
  const base = TEMPLATE_DEFS[template].audience.join('+')
  if (template === 'manager_plan_requested')    return `${base}:${payload.managerId}`
  if (template === 'pm_request_created')        return `${base}:${payload.region}`
  if (template === 'stakeholder_tasks_created') return `${base}:${payload.assigneeId}`
  // One per person per day: the person is an HMAC of the address the reminder was grouped by
  if (template === 'daily_reminder')            return `person:${payload.person}`
  return base
}

// template:hireId:audience:version. version names the state the notice is about (an assignment
// number, a timestamp, the flagged submission); '1' for events that happen once per hire.
export function dedupeKeyFor(
  template: NotificationTemplate, hireId: string | null, payload: Record<string, unknown>, version: string,
): string {
  const v = version.replace(/[^A-Za-z0-9:._+-]/g, '').slice(0, 80) || '1'
  return `${template}:${hireId ?? 'none'}:${audienceKey(template, payload)}:${v}`
}

// Queues one message. The dedupe key makes retries, refreshes and double-clicks harmless: a second
// call for the same event and state is ignored. Returns true only when this call queued a new row
// (false for a duplicate or a failure), so callers can run once-only side effects. Never throws.
export async function queueNotification<T extends NotificationTemplate>({
  template, hireId, payload, version = '1',
}: {
  template: T
  hireId:   string | null
  payload:  NotificationPayload<T>
  version?: string
}): Promise<boolean> {
  const parsed = PAYLOAD_SCHEMAS[template].safeParse(payload)
  if (!parsed.success) {
    console.error(`[notify] invalid payload for ${template}`)
    return false
  }
  const data = parsed.data as Record<string, unknown>

  const reminder = template === 'daily_reminder' ? data as DailyReminderPayload : null
  const dedupeKey = dedupeKeyFor(template, hireId, data, version)
  const audience  = reminder
    ? [...new Set(reminder.to.map(t => TARGET_AUDIENCE[t.kind]))]
    : [...TEMPLATE_DEFS[template].audience]
  try {
    // The key goes into the permanent ledger (notification_keys) and the row into the outbox in one
    // database call. A key used before, even one whose outbox row has since been cleaned up, gives
    // null: the event is never sent twice.
    const admin = createServiceClient()
    const { data: rpcId, error: rpcError } = await admin.rpc('enqueue_notification', {
      p_dedupe_key:    dedupeKey,
      p_template:      template,
      p_newhire_id:    hireId,
      p_audience:      audience,
      p_payload:       data,
      // Daily reminders keep their date and refs in the ledger: the reminder history outlives cleanup
      p_reminder_date: reminder?.date ?? null,
      p_refs:          reminder?.refs ?? [],
    })
    let id: string | null = (rpcId as string | null) ?? null
    let error = rpcError
    // Only until 20261110_notification_keys.sql is run: the function does not exist yet, so queue
    // the old way (outbox row only). Re-running statement 10 of that migration records these keys.
    if (rpcError?.code === 'PGRST202') {
      console.warn('[notify] enqueue_notification is missing: run 20261110_notification_keys.sql')
      const { data: rows, error: upsertError } = await admin.from('notification_outbox')
        .upsert({ dedupe_key: dedupeKey, template, newhire_id: hireId, audience, payload: data, status: 'queued' },
          { onConflict: 'dedupe_key', ignoreDuplicates: true })
        .select('id')
      id = rows?.[0]?.id ?? null
      error = upsertError
    }

    if (error) {
      console.error(`[notify] failed to queue notification (code ${error.code})`)
      return false
    }
    if (id) {
      console.log(`[notify] queued ${template}`)
      kickDispatcher([id])
    }
    return !!id
  } catch {
    console.error('[notify] failed to queue notification')
    return false
  }
}

// A send_after value that is already due. claim_notifications compares it with the database's clock,
// and this server's clock can be ahead of that, so "now" from here may not be due yet.
export function dueNow(): string {
  return new Date(Date.now() - 5 * 60_000).toISOString()
}

// Best effort: try to send the new rows right after the response. Never blocks or fails the
// request; outside a request (scripts) it does nothing and the cron run picks the rows up.
export function kickDispatcher(ids: string[]): void {
  try {
    after(async () => {
      try {
        const { dispatchNotifications } = await import('@/lib/notify-dispatch')
        await dispatchNotifications({ onlyIds: ids, limit: ids.length })
      } catch {
        console.error('[notify] immediate dispatch failed')
      }
    })
  } catch {
    // no request scope
  }
}

// ── Shared events ──

// The hire just entered the payroll queue (all five items approved): payroll gets "ready for
// payroll" and the hire gets "you're all set". Once per hire.
export async function queueHireApproved(hireId: string): Promise<void> {
  await queueNotification({ template: 'hire_approved', hireId, payload: {} })
  await queueNotification({ template: 'hire_all_set', hireId, payload: {} })
}
