// Notification template keys and their display names. No server imports, so the HR outbox
// page can show labels; lib/notify.ts re-exports these for server code.
export const NOTIFICATION_TEMPLATES = [
  'manager_plan_requested', 'manager_plan_submitted', 'clearance_unlocked', 'clearance_submitted',
  'onboarding_complete', 'pm_request_created', 'pm_request_done',
  'clearance_package_sent', 'clearance_package_returned', 'clearance_package_done',
  'vehicle_rob_task', 'vehicle_heather_task', 'vehicle_insurance_task', 'vehicle_complete',
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
  clearance_package_sent:     'Clearance package sent for review',
  clearance_package_returned: 'Clearance package returned to HR',
  clearance_package_done:     'Clearance package done',
  vehicle_rob_task:           'Company vehicle: details requested (Rob)',
  vehicle_heather_task:       'Company vehicle: ready to check (Heather)',
  vehicle_insurance_task:     'Company vehicle: insurance ready (Marley)',
  vehicle_complete:           'Company vehicle: all steps complete',
}
