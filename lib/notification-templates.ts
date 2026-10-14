// Notification template keys and their display names. No server imports, so the HR outbox
// page can show labels; lib/notify.ts re-exports these for server code.
export const NOTIFICATION_TEMPLATES = ['manager_plan_requested', 'manager_plan_submitted'] as const
export type NotificationTemplate = typeof NOTIFICATION_TEMPLATES[number]

export const TEMPLATE_LABELS: Record<NotificationTemplate, string> = {
  manager_plan_requested: 'Manager plan requested',
  manager_plan_submitted: 'Manager plan submitted',
}
