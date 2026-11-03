import { esc } from '@/lib/safe-html'

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
