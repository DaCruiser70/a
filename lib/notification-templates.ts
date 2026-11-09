// Notification templates: display names, who each one is for, and where its link points. No server
// imports, so the HR outbox page can show labels; lib/notify.ts re-exports these for server code.
//
// The audience here is the only source of recipients: the dispatcher (lib/notify-dispatch.ts) looks
// up the people for each audience at send time. Nothing in a queued row can add a recipient.
export const NOTIFICATION_TEMPLATES = [
  'manager_plan_requested', 'manager_plan_submitted', 'clearance_unlocked', 'clearance_submitted',
  'onboarding_complete', 'pm_request_created', 'pm_request_done',
  'clearance_package_sent', 'clearance_package_returned', 'clearance_package_done',
  'vehicle_rob_task', 'vehicle_heather_task', 'vehicle_license_review', 'vehicle_insurance_task', 'vehicle_complete',
  'item_flagged', 'hire_approved', 'hire_all_set', 'payroll_done', 'stakeholder_tasks_created',
] as const
export type NotificationTemplate = typeof NOTIFICATION_TEMPLATES[number]

// Who a notification goes to
//   hr               HR_NOTIFY_EMAILS
//   hire             the hire's own address (personal email if HR gave one, else the login)
//   payroll          active accounts holding the payroll role
//   clearance        active accounts holding the clearance role
//   manager          the assigned manager (active managers row, linked to an active manager account)
//   pm_region        the active project management team members of the request's region
//   stakeholder      the stakeholder the task was assigned to (active, stakeholder role)
//   vehicle_*        the account for that company vehicle step (lib/stakeholder-mapping.ts)
export const AUDIENCES = [
  'hr', 'hire', 'payroll', 'clearance', 'manager', 'pm_region', 'stakeholder',
  'vehicle_rob', 'vehicle_heather', 'vehicle_marley',
] as const
export type Audience = typeof AUDIENCES[number]

// Shown on HR's page and in the "[TEST → …]" subject prefix. Roles and step names only.
export const AUDIENCE_LABELS: Record<Audience, string> = {
  hr:              'HR',
  hire:            'New hire',
  payroll:         'Payroll',
  clearance:       'Clearance review',
  manager:         'Manager',
  pm_region:       'Project management',
  stakeholder:     'Stakeholder',
  vehicle_rob:     'Vehicle: Rob',
  vehicle_heather: 'Vehicle: Heather',
  vehicle_marley:  'Vehicle: Marley',
}

// Portal pages a notification may link to. The link is built from NEXT_PUBLIC_APP_URL and one of
// these patterns only, never from anything stored or typed by a person. Each page enforces sign-in
// and role itself.
export const LINK_ROUTES = {
  hr_hire:           (id: string) => `/hr/newhire/${id}`,
  hr_hire_clearance: (id: string) => `/hr/newhire/${id}?tab=clearance`,
  hr_hire_equipment: (id: string) => `/hr/newhire/${id}?tab=equipment`,
  manager_hire:      (id: string) => `/manager/newhire/${id}`,
  pm_hire:           (id: string) => `/project-mgmt/newhire/${id}`,
  clearance_hire:    (id: string) => `/clearance/newhire/${id}`,
  stakeholder_hire:  (id: string) => `/stakeholder/newhire/${id}`,
  payroll_queue:     () => '/payroll/dashboard',
  newhire_forms:     () => '/newhire/forms',
  newhire_clearance: () => '/newhire/forms/clearance',
  newhire_welcome:   () => '/newhire/welcome',
} as const
export type LinkRoute = keyof typeof LINK_ROUTES

// Where a hire-specific link falls back to when the row has no hire (the portal's home)
const LINK_FALLBACK: Record<LinkRoute, string> = {
  hr_hire: '/hr/dashboard', hr_hire_clearance: '/hr/dashboard', hr_hire_equipment: '/hr/dashboard',
  manager_hire: '/manager/dashboard', pm_hire: '/project-mgmt/dashboard', clearance_hire: '/clearance/dashboard',
  stakeholder_hire: '/stakeholder/dashboard', payroll_queue: '/payroll/dashboard',
  newhire_forms: '/newhire/forms', newhire_clearance: '/newhire/forms/clearance', newhire_welcome: '/newhire/welcome',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function linkPath(route: LinkRoute, hireId: string | null): string {
  return hireId && UUID.test(hireId) ? LINK_ROUTES[route](hireId) : LINK_FALLBACK[route]
}

// A person reached through more than one audience of a template gets one email (the dispatcher
// merges by address).
type TemplateDef = { label: string; audience: Audience[]; link: LinkRoute }

export const TEMPLATE_DEFS: Record<NotificationTemplate, TemplateDef> = {
  manager_plan_requested:     { label: 'Manager plan requested',                       audience: ['manager'],         link: 'manager_hire' },
  manager_plan_submitted:     { label: 'Manager plan submitted',                       audience: ['hr'],              link: 'hr_hire' },
  clearance_unlocked:         { label: 'Security clearance form unlocked',             audience: ['hire'],            link: 'newhire_clearance' },
  clearance_submitted:        { label: 'Security clearance form submitted',            audience: ['hr'],              link: 'hr_hire_clearance' },
  onboarding_complete:        { label: 'All required forms received',                  audience: ['hr'],              link: 'hr_hire' },
  pm_request_created:         { label: 'Project management request opened',           audience: ['pm_region'],       link: 'pm_hire' },
  pm_request_done:            { label: 'Project management request done',             audience: ['hr'],              link: 'hr_hire' },
  clearance_package_sent:     { label: 'Clearance package sent for review',            audience: ['clearance'],       link: 'clearance_hire' },
  clearance_package_returned: { label: 'Clearance package returned to HR',             audience: ['hr'],              link: 'hr_hire_clearance' },
  clearance_package_done:     { label: 'Clearance package done',                       audience: ['hr'],              link: 'hr_hire_clearance' },
  vehicle_rob_task:           { label: 'Company vehicle: details requested (Rob)',     audience: ['vehicle_rob'],     link: 'stakeholder_hire' },
  vehicle_heather_task:       { label: 'Company vehicle: ready to check (Heather)',    audience: ['vehicle_heather'], link: 'stakeholder_hire' },
  vehicle_license_review:     { label: 'Company vehicle: Driver’s Licence to approve', audience: ['hr'],              link: 'hr_hire' },
  vehicle_insurance_task:     { label: 'Company vehicle: insurance ready (Marley)',    audience: ['vehicle_marley'],  link: 'stakeholder_hire' },
  vehicle_complete:           { label: 'Company vehicle: all steps complete',          audience: ['hr'],              link: 'hr_hire_equipment' },
  item_flagged:               { label: 'Item sent back to the hire',                   audience: ['hire'],            link: 'newhire_forms' },
  hire_approved:              { label: 'Ready for payroll',                            audience: ['payroll'],         link: 'payroll_queue' },
  hire_all_set:               { label: 'Hire told they are all set',                   audience: ['hire'],            link: 'newhire_welcome' },
  payroll_done:               { label: 'Payroll complete',                             audience: ['hr'],              link: 'hr_hire' },
  stakeholder_tasks_created:  { label: 'Stakeholder task assigned',                    audience: ['stakeholder'],     link: 'stakeholder_hire' },
}

export const TEMPLATE_LABELS: Record<NotificationTemplate, string> = Object.fromEntries(
  NOTIFICATION_TEMPLATES.map(t => [t, TEMPLATE_DEFS[t].label]),
) as Record<NotificationTemplate, string>

export function isNotificationTemplate(value: unknown): value is NotificationTemplate {
  return typeof value === 'string' && (NOTIFICATION_TEMPLATES as readonly string[]).includes(value)
}

// The sections a flag notice may name (the four forms and Documents). Never the HR note.
export const FLAG_SECTIONS = ['personal', 'banking', 'sin', 'policy', 'documents'] as const
export type FlagSection = typeof FLAG_SECTIONS[number]
export const FLAG_SECTION_LABELS: Record<FlagSection, string> = {
  personal:  'Personal information',
  banking:   'Banking',
  sin:       'SIN',
  policy:    'Policies',
  documents: 'Documents',
}

// HR's page: what a stored error code means (codes only are ever stored)
export const ERROR_CODE_LABELS: Record<string, string> = {
  auth_failed:      'The mail account could not sign in',
  throttled:        'The mail service asked us to slow down',
  rejected:         'The mail service refused the message',
  network:          'The mail service could not be reached',
  no_recipients:    'Nobody active to send it to',
  lookup_failed:    'The recipients could not be looked up',
  no_app_url:       'The portal address is not set up',
  bad_payload:      'The notification was incomplete',
  unknown_template: 'Unknown notification type',
  invalid:          'The message could not be built',
  backlog:          'Queued before email was switched on; not sent',
  unknown:          'Unknown error',
}
