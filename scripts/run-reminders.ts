// Runs the daily reminder logic by hand (the same code as /api/cron/daily-reminders). Prints counts
// per reminder type only: never a name, an address or an id.
//
// Dry run by default: works out what is due and queues nothing. --apply queues the reminders in the
// outbox (the dispatcher sends them, in the current EMAIL_MODE). While paused, --apply queues nothing.
//
// Usage (from the project root):
//   npx tsx --env-file=.env.local scripts/run-reminders.ts                         dry run for today (Toronto)
//   npx tsx --env-file=.env.local scripts/run-reminders.ts --as-of 2026-11-12      dry run as if it were that day
//   npx tsx --env-file=.env.local scripts/run-reminders.ts --apply                 queue today's reminders
//   ... --as-of <another day> --apply --i-know                                     queue with a pretend date
//
// --apply with an --as-of that is not today is refused unless --i-know is also given: a pretend date
// would queue real reminders, to real people, dated for another day.

import { createServiceClient } from '../lib/supabase/server'
import { runDailyReminders } from '../lib/reminders'
import { remindersPaused } from '../lib/reminder-settings'
import { isBusinessDay, isIsoDate, torontoDate } from '../lib/business-days'

async function main() {
  const args  = process.argv.slice(2)
  const apply = args.includes('--apply')
  const iKnow = args.includes('--i-know')
  const i     = args.indexOf('--as-of')
  const today = torontoDate(new Date())
  const asOf  = i >= 0 ? args[i + 1] ?? '' : today

  const known = new Set(['--apply', '--i-know', '--as-of'])
  if (args.some((a, n) => a.startsWith('--') ? !known.has(a) : n !== i + 1 || i < 0)) {
    console.error('Usage: scripts/run-reminders.ts [--as-of YYYY-MM-DD] [--apply [--i-know]]')
    process.exitCode = 1
    return
  }
  if (!isIsoDate(asOf)) {
    console.error('--as-of needs a real date as YYYY-MM-DD.')
    process.exitCode = 1
    return
  }
  if (apply && asOf !== today && !iKnow) {
    console.error(`Refusing: --apply with --as-of ${asOf} (today in Toronto is ${today}) would queue real reminders with a pretend date. Add --i-know if you really mean it.`)
    process.exitCode = 1
    return
  }

  console.log(`As of ${asOf}${asOf === today ? ' (today)' : ''}${isBusinessDay(asOf) ? '' : ': not a business day (the cron would not run)'}`)
  console.log(apply ? 'Mode: APPLY (reminders are queued in the outbox)' : 'Mode: dry run (nothing is queued)')

  const admin = createServiceClient()
  if (await remindersPaused(admin)) console.log('Reminders are PAUSED (or the setting could not be read): --apply would queue nothing.')
  const result = await runDailyReminders(admin, { asOf, apply })
  if (result.paused) {
    console.log('Nothing was queued.')
    return
  }
  const c = result.counts
  console.log('Due today:')
  console.log(`  hire not finished:        ${c.hireUnfinished}`)
  console.log(`  hire flagged form:        ${c.hireFlagged}`)
  console.log(`  stakeholder tasks:        ${c.tasks}`)
  console.log(`  manager plans:            ${c.plans}`)
  console.log(`  project mgmt unclaimed:   ${c.pmOpen}`)
  console.log(`  project mgmt claimed:     ${c.pmClaimed}`)
  console.log(`  payroll hires waiting:    ${c.payroll}`)
  console.log(`  HR digest:                ${c.digest ? 'yes' : 'no (nothing to report)'}`)
  console.log(`  regions with no team:     ${c.noTeam}`)
  console.log(`Emails (one per person):    ${result.emails}`)
  console.log(`People not reachable now:   ${result.unreachable}`)
  if (apply) console.log(`Queued: ${result.queued}, already queued for this date: ${result.duplicates}`)
}

main().catch(e => { console.error(e instanceof Error ? e.message : 'The run failed.'); process.exitCode = 1 })
