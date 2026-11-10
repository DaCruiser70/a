import { esc } from '@/lib/safe-html'
import type { NotificationTemplate } from '@/lib/notification-templates'

// Email templates (HTML + plain text) for lib/mailer.ts. Everything interpolated is escaped.
// No remote images or fonts: the header is text, and the fonts fall back to Georgia and Arial.
// A code appears in the body only: never in the subject, the preview text or a link.

export type EmailContent = { subject: string; html: string; text: string }

const NAVY   = '#1B3A6B'
const AMBER  = '#C8920A'
const TEXT   = '#1a2e25'
const MUTED  = '#5F5E5A'
const BORDER = '#E8E3DA'
const PAGE   = '#F4F1EC'
const HEAD_FONT = "Lora, Georgia, 'Times New Roman', serif"
const BODY_FONT = "'Plus Jakarta Sans', Arial, Helvetica, sans-serif"

const FOOTER = 'Sent by the AEM Employee Onboarding portal. This is an automated message; replies are not monitored.'

function layout({ title, preview, bodyHtml }: { title: string; preview: string; bodyHtml: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${esc(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${BORDER};border-radius:14px;overflow:hidden;">
<tr><td style="background:${NAVY};padding:22px 28px;">
<div style="font-family:${HEAD_FONT};font-size:24px;font-weight:700;color:#ffffff;letter-spacing:1px;">AEM</div>
<div style="font-family:${BODY_FONT};font-size:12px;font-weight:700;color:${AMBER};letter-spacing:1px;text-transform:uppercase;margin-top:4px;">Employee Onboarding</div>
</td></tr>
<tr><td style="height:4px;background:${AMBER};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px;font-family:${BODY_FONT};font-size:15px;line-height:1.6;color:${TEXT};">
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid ${BORDER};font-family:${BODY_FONT};font-size:12px;line-height:1.5;color:${MUTED};">${esc(FOOTER)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

function codeEmail({ subject, heading, intro, code, minutes }: {
  subject: string; heading: string; intro: string; code: string; minutes: number
}): EmailContent {
  const expiry  = `This code expires in ${minutes} minutes and can be used once.`
  const warning = 'If you did not request this code, do not share it with anyone and tell HR.'
  const bodyHtml = `
<h1 style="margin:0 0 12px;font-family:${HEAD_FONT};font-size:22px;line-height:1.3;color:${NAVY};font-weight:700;">${esc(heading)}</h1>
<p style="margin:0 0 20px;">${esc(intro)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
<tr><td style="background:#F7F4EE;border-left:4px solid ${AMBER};border-radius:8px;padding:14px 22px;font-family:${BODY_FONT};font-size:34px;font-weight:700;letter-spacing:8px;color:${NAVY};">${esc(code)}</td></tr>
</table>
<p style="margin:0 0 12px;">${esc(expiry)}</p>
<p style="margin:0 0 20px;color:${MUTED};">${esc(warning)}</p>`
  return {
    subject,
    html: layout({ title: subject, preview: intro, bodyHtml }),
    text: `${heading}\n\n${intro}\n\n    ${code}\n\n${expiry}\n${warning}\n\n${FOOTER}\n`,
  }
}

// "Your sign-in code"
export function signInCodeEmail(code: string, ttlSeconds: number): EmailContent {
  return codeEmail({
    subject: 'Your AEM sign-in code',
    heading: 'Your sign-in code',
    intro:   'Use this code to finish signing in to the AEM Employee Onboarding portal.',
    code,
    minutes: Math.round(ttlSeconds / 60),
  })
}

// "Your code to view sensitive information". recordType names the kind of record only
// (for example "banking details"), never whose it is or any value.
export function revealCodeEmail(code: string, ttlSeconds: number, recordType: string): EmailContent {
  return codeEmail({
    subject: 'Your code to view sensitive information',
    heading: 'Your code to view sensitive information',
    intro:   `Use this code to view the ${recordType} you asked to see in the AEM Employee Onboarding portal.`,
    code,
    minutes: Math.round(ttlSeconds / 60),
  })
}

// ── Set-password links (welcome and reset) ──
// Names and a link only: never a password or any sensitive value. The link is the only secret and
// appears in the button and once as plain text.

const HR_CONTACT = 'hr@aemltd.com'

function linkEmail({ subject, heading, paragraphs, details, button, link, hours }: {
  subject: string; heading: string; paragraphs: string[]; details: string[]
  button: string; link: string; hours: number
}): EmailContent {
  const expiry   = `This link expires in ${hours} hours and can be used once.`
  const fallback = 'If the button does not work, copy this link into your browser:'
  const contact  = `Questions? Contact HR at ${HR_CONTACT}.`
  const ignore   = 'If you were not expecting this email, you can ignore it. Nothing changes until the link is used.'
  const bodyHtml = `
<h1 style="margin:0 0 12px;font-family:${HEAD_FONT};font-size:22px;line-height:1.3;color:${NAVY};font-weight:700;">${esc(heading)}</h1>
${paragraphs.map(p => `<p style="margin:0 0 16px;">${esc(p)}</p>`).join('\n')}
${details.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="background:#F7F4EE;border-left:4px solid ${AMBER};border-radius:8px;padding:12px 18px;font-family:${BODY_FONT};font-size:14px;line-height:1.7;color:${TEXT};">${details.map(d => esc(d)).join('<br>')}</td></tr></table>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">
<tr><td style="border-radius:10px;background:${NAVY};">
<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 26px;font-family:${BODY_FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;border-bottom:3px solid ${AMBER};">${esc(button)}</a>
</td></tr>
</table>
<p style="margin:0 0 12px;">${esc(expiry)}</p>
<p style="margin:0 0 6px;color:${MUTED};font-size:13px;">${esc(fallback)}</p>
<p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${esc(link)}" target="_blank" rel="noopener noreferrer" style="color:${NAVY};">${esc(link)}</a></p>
<p style="margin:0 0 12px;">${esc(contact)}</p>
<p style="margin:0 0 20px;color:${MUTED};font-size:13px;">${esc(ignore)}</p>`
  const text = [
    heading, '', ...paragraphs.flatMap(p => [p, '']),
    ...(details.length ? [...details, ''] : []),
    `${button}:`, link, '', expiry, contact, ignore, '', FOOTER, '',
  ].join('\n')
  return { subject, html: layout({ title: subject, preview: paragraphs[0], bodyHtml }), text }
}

// "Welcome to AEM, [first name]". startDate: a readable date; office: the office name. Both optional.
export function welcomeEmail({ firstName, startDate, office, link, ttlSeconds }: {
  firstName: string; startDate: string | null; office: string | null; link: string; ttlSeconds: number
}): EmailContent {
  const name = firstName.trim()
  return linkEmail({
    subject:    'Welcome to AEM: set your password',
    heading:    name ? `Welcome to AEM, ${name}` : 'Welcome to AEM',
    paragraphs: [
      'We are glad you are joining us. Your onboarding account is ready.',
      'Set your password to sign in and complete your onboarding forms before your first day.',
    ],
    details: [
      ...(startDate ? [`Start date: ${startDate}`] : []),
      ...(office ? [`Office: ${office}`] : []),
    ],
    button: 'Set your password and get started',
    link,
    hours: Math.round(ttlSeconds / 3600),
  })
}

// Forgot password, or HR sending a reset: same look, different wording
export function passwordResetEmail({ firstName, link, ttlSeconds }: {
  firstName: string; link: string; ttlSeconds: number
}): EmailContent {
  const name = firstName.trim()
  return linkEmail({
    subject:    'Reset your AEM onboarding password',
    heading:    name ? `Reset your password, ${name}` : 'Reset your password',
    paragraphs: [
      'Someone asked to reset the password for your AEM Employee Onboarding account.',
      'Use the button below to choose a new password. Your current password keeps working until you do.',
    ],
    details: [],
    button: 'Choose a new password',
    link,
    hours: Math.round(ttlSeconds / 3600),
  })
}

// ── Notifications (lib/notify-dispatch.ts) ──
// Names, dates and one portal link only. Never SIN, banking, date of birth, clearance details, ID
// numbers, document contents or an HR note. Subjects are short and carry at most the hire's name.

export type NoticeContext = {
  hireName:   string          // '' when unknown
  firstName:  string          // the recipient's first name, for notices to the hire
  startDate:  string | null   // readable date
  section:    string | null   // item_flagged: the section label (never the note)
  taskNames:  string[]        // stakeholder_tasks_created: fixed task labels
  link:       string
}

type NoticeParts = { subject: string; heading: string; paragraphs: string[]; details: string[]; button: string }

// Removes line breaks and runs of spaces from a name before it goes into a subject or a sentence
function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

function noticeParts(template: NotificationTemplate, c: NoticeContext): NoticeParts {
  const name  = oneLine(c.hireName) || 'a new hire'
  const Name  = oneLine(c.hireName) || 'A new hire'
  const forName = (prefix: string) => oneLine(c.hireName) ? `${prefix}: ${oneLine(c.hireName)}` : prefix
  const starts  = c.startDate ? [`Start date: ${c.startDate}`] : []
  const hi      = oneLine(c.firstName) ? `Hi ${oneLine(c.firstName)},` : 'Hello,'

  switch (template) {
    case 'manager_plan_requested': return {
      subject: c.startDate ? `New hire starting ${c.startDate}` : forName('New hire on your team'),
      heading: 'A new hire is joining your team',
      paragraphs: [`${Name} is joining your team. Please fill in their onboarding plan in the portal.`],
      details: [`New hire: ${name}`, ...starts], button: 'Open the onboarding plan',
    }
    case 'manager_plan_submitted': return {
      subject: forName('Manager plan submitted'), heading: 'Onboarding plan submitted',
      paragraphs: [`The manager has submitted the onboarding plan for ${name}.`],
      details: starts, button: 'Open the hire record',
    }
    case 'clearance_unlocked': return {
      subject: 'Your security clearance form is ready', heading: 'Your security clearance form is ready',
      paragraphs: [hi, 'There is one more form for you to complete in the onboarding portal: the security clearance form.'],
      details: [], button: 'Open the clearance form',
    }
    case 'clearance_submitted': return {
      subject: forName('Clearance form submitted'), heading: 'Security clearance form submitted',
      paragraphs: [`${Name} has submitted the security clearance form. It is ready for your review in the portal.`],
      details: [], button: 'Open the hire record',
    }
    case 'onboarding_complete': return {
      subject: forName('Ready for review'), heading: 'Onboarding items ready for review',
      paragraphs: [`${Name} has sent all five onboarding items. They are ready for your review.`],
      details: starts, button: 'Open the hire record',
    }
    case 'pm_request_created': return {
      subject: forName('Project details needed'), heading: 'Project details needed',
      paragraphs: [`Project management details are needed for ${name}. Anyone on your regional team can pick this up in the portal.`],
      details: starts, button: 'Open the request',
    }
    case 'pm_request_done': return {
      subject: forName('Project details complete'), heading: 'Project details complete',
      paragraphs: [`Project management has finished the project details for ${name}.`],
      details: [], button: 'Open the hire record',
    }
    case 'clearance_package_sent': return {
      subject: forName('Clearance package ready'), heading: 'A clearance package is ready for review',
      paragraphs: [`The clearance package for ${name} is ready for your review in the portal.`],
      details: [], button: 'Open the package',
    }
    case 'clearance_package_returned': return {
      subject: forName('Clearance package returned'), heading: 'Clearance package returned',
      paragraphs: [`The clearance reviewer sent the package for ${name} back to HR. See the portal for details.`],
      details: [], button: 'Open the clearance tab',
    }
    case 'clearance_package_done': return {
      subject: forName('Clearance package done'), heading: 'Clearance package done',
      paragraphs: [`The clearance reviewer marked the package for ${name} as done.`],
      details: [], button: 'Open the clearance tab',
    }
    case 'vehicle_rob_task': return {
      subject: forName('Company vehicle details needed'), heading: 'Company vehicle: your step',
      paragraphs: [`${Name} needs a company vehicle. Please fill in the vehicle details in the portal.`],
      details: starts, button: 'Open the vehicle request',
    }
    case 'vehicle_heather_task': return {
      subject: forName('Company vehicle details to check'), heading: 'Company vehicle: your step',
      paragraphs: [`The vehicle details for ${name} are ready for you to check and complete in the portal.`],
      details: starts, button: 'Open the vehicle request',
    }
    case 'vehicle_license_review': return {
      subject: forName('Driver’s Licence to approve'), heading: 'Driver’s Licence approval needed',
      paragraphs: [`The company vehicle details for ${name} are complete. The insurance step starts once the hire’s Driver’s Licence is uploaded and approved by HR.`],
      details: [], button: 'Open the hire record',
    }
    case 'vehicle_insurance_task': return {
      subject: forName('Company vehicle insurance'), heading: 'Company vehicle: your step',
      paragraphs: [`The company vehicle for ${name} is ready for insurance. Please confirm it in the portal.`],
      details: starts, button: 'Open the vehicle request',
    }
    case 'vehicle_complete': return {
      subject: forName('Company vehicle complete'), heading: 'Company vehicle steps complete',
      paragraphs: [`All company vehicle steps for ${name} are complete.`],
      details: [], button: 'Open the equipment tab',
    }
    case 'item_flagged': return {
      subject: 'Action needed on your onboarding', heading: 'One section needs a fix',
      paragraphs: [hi, `Your onboarding team has asked you to update the ${c.section ?? 'flagged'} section. See the portal for details.`],
      details: [], button: 'Open my forms',
    }
    case 'hire_approved': return {
      subject: forName('Ready for payroll'), heading: 'Ready for payroll',
      paragraphs: [`HR has approved every onboarding item for ${name}. They are now in the payroll queue.`],
      details: starts, button: 'Open the payroll queue',
    }
    case 'hire_all_set': return {
      subject: 'You’re all set', heading: 'You’re all set',
      paragraphs: [hi, 'HR has approved all of your onboarding items. There is nothing more for you to do. We look forward to your first day.'],
      details: starts, button: 'Open the portal',
    }
    case 'payroll_done': return {
      subject: forName('Payroll complete'), heading: 'Payroll complete',
      paragraphs: [`Payroll has finished setting up ${name}.`],
      details: [], button: 'Open the hire record',
    }
    case 'stakeholder_tasks_created': return {
      subject: forName('New onboarding task'), heading: c.taskNames.length > 1 ? 'New onboarding tasks' : 'New onboarding task',
      paragraphs: [`You have ${c.taskNames.length > 1 ? 'new tasks' : 'a new task'} for ${name}.`],
      details: [...c.taskNames.map(t => `Task: ${oneLine(t)}`), ...starts], button: 'Open the tasks',
    }
    // Built by reminderEmail() instead; this is only a safe fallback
    case 'daily_reminder': return {
      subject: 'Onboarding reminders', heading: 'Onboarding reminders',
      paragraphs: ['You have onboarding items waiting in the portal.'], details: [], button: 'Open the portal',
    }
  }
}

export function noticeEmail(template: NotificationTemplate, ctx: NoticeContext): EmailContent {
  const { subject, heading, paragraphs, details, button } = noticeParts(template, ctx)
  const fallback = 'If the button does not work, copy this link into your browser:'
  const signIn   = 'You will be asked to sign in.'
  const bodyHtml = `
<h1 style="margin:0 0 12px;font-family:${HEAD_FONT};font-size:22px;line-height:1.3;color:${NAVY};font-weight:700;">${esc(heading)}</h1>
${paragraphs.map(p => `<p style="margin:0 0 16px;">${esc(p)}</p>`).join('\n')}
${details.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;"><tr><td style="background:#F7F4EE;border-left:4px solid ${AMBER};border-radius:8px;padding:12px 18px;font-family:${BODY_FONT};font-size:14px;line-height:1.7;color:${TEXT};">${details.map(d => esc(d)).join('<br>')}</td></tr></table>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">
<tr><td style="border-radius:10px;background:${NAVY};">
<a href="${esc(ctx.link)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 26px;font-family:${BODY_FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;border-bottom:3px solid ${AMBER};">${esc(button)}</a>
</td></tr>
</table>
<p style="margin:0 0 12px;color:${MUTED};font-size:13px;">${esc(signIn)}</p>
<p style="margin:0 0 6px;color:${MUTED};font-size:13px;">${esc(fallback)}</p>
<p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${esc(ctx.link)}" target="_blank" rel="noopener noreferrer" style="color:${NAVY};">${esc(ctx.link)}</a></p>`
  const text = [
    heading, '', ...paragraphs.flatMap(p => [p, '']),
    ...(details.length ? [...details, ''] : []),
    `${button}:`, ctx.link, signIn, '', FOOTER, '',
  ].join('\n')
  return { subject, html: layout({ title: subject, preview: paragraphs[paragraphs.length - 1], bodyHtml }), text }
}

// ── Daily reminders (lib/reminders-render.ts builds the view) ──
// One email per person per day: one block per kind of reminder, each with its own portal button.
// Names, form titles, counts and dates only. Everything is escaped here.

export type ReminderBlock = { heading: string; lines: string[]; items: string[]; button: string; link: string }
export type ReminderView  = { subject: string; greeting: string | null; blocks: ReminderBlock[] }

export function reminderEmail(view: ReminderView): EmailContent {
  const subject = oneLine(view.subject)
  const blocksHtml = view.blocks.map(b => `
<h2 style="margin:8px 0 8px;font-family:${HEAD_FONT};font-size:18px;line-height:1.3;color:${NAVY};font-weight:700;">${esc(b.heading)}</h2>
${b.lines.map(l => `<p style="margin:0 0 12px;">${esc(l)}</p>`).join('\n')}
${b.items.length ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr><td style="background:#F7F4EE;border-left:4px solid ${AMBER};border-radius:8px;padding:12px 18px;font-family:${BODY_FONT};font-size:14px;line-height:1.7;color:${TEXT};">${b.items.map(i => esc(oneLine(i))).join('<br>')}</td></tr></table>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;">
<tr><td style="border-radius:10px;background:${NAVY};">
<a href="${esc(b.link)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 22px;font-family:${BODY_FONT};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;border-bottom:3px solid ${AMBER};">${esc(b.button)}</a>
</td></tr>
</table>`).join('\n')
  const signIn = 'Each button opens the portal. You will be asked to sign in.'
  const bodyHtml = `
<h1 style="margin:0 0 12px;font-family:${HEAD_FONT};font-size:22px;line-height:1.3;color:${NAVY};font-weight:700;">${esc(subject)}</h1>
${view.greeting ? `<p style="margin:0 0 16px;">${esc(view.greeting)}</p>` : ''}
${blocksHtml}
<p style="margin:0 0 20px;color:${MUTED};font-size:13px;">${esc(signIn)}</p>`
  const text = [
    subject, '', ...(view.greeting ? [view.greeting, ''] : []),
    ...view.blocks.flatMap(b => [b.heading, ...b.lines, ...b.items.map(i => `  - ${oneLine(i)}`), `${b.button}: ${b.link}`, '']),
    signIn, '', FOOTER, '',
  ].join('\n')
  const preview = view.blocks[0]?.lines[0] ?? view.blocks[0]?.heading ?? subject
  return { subject, html: layout({ title: subject, preview, bodyHtml }), text }
}

// scripts/test-email.ts: a harmless message to check delivery
export function testEmail(): EmailContent {
  const subject = 'AEM onboarding: test email'
  const lines = [
    'This is a test email from the AEM Employee Onboarding portal.',
    'If you can read this, email delivery is working. No action is needed.',
  ]
  const bodyHtml = `
<h1 style="margin:0 0 12px;font-family:${HEAD_FONT};font-size:22px;line-height:1.3;color:${NAVY};font-weight:700;">Test email</h1>
${lines.map(l => `<p style="margin:0 0 16px;">${esc(l)}</p>`).join('\n')}`
  return { subject, html: layout({ title: subject, preview: lines[0], bodyHtml }), text: `Test email\n\n${lines.join('\n')}\n\n${FOOTER}\n` }
}
