// Notification template keys and their display names. No server imports, so the HR outbox
// page can show labels; lib/notify.ts re-exports these for server code.
export const NOTIFICATION_TEMPLATES = [
  'manager_plan_requested', 'manager_plan_submitted', 'clearance_unlocked', 'clearance_submitted',
  'onboarding_complete', 'pm_request_created', 'pm_request_done',
] as const
export type NotificationTemplate = typeof NOTIFICATION_TEMPLATES[number]

export const TEMPLATE_LABELS: Record<NotificationTemplate, string> = {
  manager_plan_requested: 'Manager plan requested',
  manager_plan_submitted: 'Manager plan submitted',
  clearance_unlocked:     'Security clearance form unlocked',
  clearance_submitted:    'Security clearance form submitted',
  onboarding_complete:    'All required forms received',
  pm_request_created:     'Project management request opened',
  pm_request_done:        'Project management request done',
}
