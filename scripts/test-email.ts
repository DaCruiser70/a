// Sends one harmless test email through lib/mailer.ts in the current EMAIL_MODE. Prints status only:
// never the address, the subject, the body or any credential.
//
// Usage (from the project root):
//   npx tsx --env-file=.env.local scripts/test-email.ts you@aemltd.com --dry-run
//   npx tsx --env-file=.env.local scripts/test-email.ts you@aemltd.com
//   npx tsx --env-file=.env.local scripts/test-email.ts you@aemltd.com --yes     (required in live mode)
//
// --dry-run builds the message and checks the settings; nothing is sent.

import { z } from 'zod'
import { send, mailConfig } from '../lib/mailer'
import { testEmail } from '../lib/email-templates'

async function main() {
  const args   = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const yes    = args.includes('--yes')
  const to     = args.find(a => !a.startsWith('--'))

  if (!to || !z.email().safeParse(to).success) {
    console.error('Usage: scripts/test-email.ts <email address> [--dry-run] [--yes]')
    process.exit(1)
  }

  const config = mailConfig()
  console.log(`Mode: ${config.mode ?? 'missing or invalid'}`)
  console.log(`Settings complete: ${config.ready ? 'yes' : 'no'}`)
  if (config.mode === 'test') console.log('Test mode: the email goes to EMAIL_TEST_RECIPIENT, not the address given.')

  if (config.mode === 'live' && !yes && !dryRun) {
    console.error('Live mode sends to the real address. Run again with --yes to confirm.')
    process.exit(1)
  }

  const content = testEmail()
  if (dryRun) {
    console.log(`Dry run: message built (HTML ${content.html.length} chars, text ${content.text.length} chars). Nothing sent.`)
    return
  }

  const result = await send({ to, ...content, category: 'test', saveToSentItems: false })
  console.log(`Result: ${result.ok ? 'ok' : 'not sent'} (${result.status})`)
  if (!result.ok) process.exit(1)
}

main().catch(() => {
  console.error('Test email failed.')
  process.exit(1)
})
