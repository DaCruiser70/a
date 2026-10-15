import { createServiceClient } from '@/lib/supabase/server'

// Notification outbox. queueNotification() only records a message in notification_outbox;
// nothing is sent from here. A sender will later read pending rows.
//
// Payloads carry ids, the hire's name and portal links only — never personal or sensitive data.

import type { NotificationTemplate } from '@/lib/notification-templates'
export { NOTIFICATION_TEMPLATES, TEMPLATE_LABELS, type NotificationTemplate } from '@/lib/notification-templates'

type PayloadByTemplate = {
  manager_plan_requested: { newhireId: string; managerId: string; hireName: string; link: string }
  manager_plan_submitted: { newhireId: string; managerId: string; hireName: string; link: string }
  clearance_unlocked:     { newhireId: string; hireName: string; link: string }
  clearance_submitted:    { newhireId: string; hireName: string; link: string }
  onboarding_complete:    { newhireId: string; hireName: string; link: string }
}

export function appUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export function hrNotifyEmails(): string[] {
  return parseEmails(process.env.HR_NOTIFY_EMAILS || 'hr@aemltd.com')
}

function parseEmails(value: string | string[]): string[] {
  const list = Array.isArray(value) ? value : value.split(',')
  return [...new Set(
    list.map(e => e.trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254)
  )]
}

// Queues one message. The dedupe key makes retries and double-clicks harmless: a second call
// with the same key is ignored. Returns true only when this call queued a new message (false for
// a duplicate or a failure), so callers can run once-only side effects. Never throws.
export async function queueNotification<T extends NotificationTemplate>({
  template, to, payload, dedupeKey,
}: {
  template:  T
  to:        string | string[]
  payload:   PayloadByTemplate[T]
  dedupeKey: string
}): Promise<boolean> {
  const toEmails = parseEmails(to)
  if (toEmails.length === 0) {
    console.error(`[notify] no valid recipients for ${template}`)
    return false
  }

  try {
    // ON CONFLICT DO NOTHING returns only rows it actually inserted
    const { data, error } = await createServiceClient()
      .from('notification_outbox')
      .upsert({
        dedupe_key: dedupeKey,
        to_emails:  toEmails,
        template,
        payload,
        status:     'pending',
      }, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id')

    if (error) {
      console.error('[notify] failed to queue notification')
      return false
    }
    const inserted = (data?.length ?? 0) > 0
    if (inserted) console.log(`[notify] queued ${template}`)
    return inserted
  } catch {
    console.error('[notify] failed to queue notification')
    return false
  }
}
