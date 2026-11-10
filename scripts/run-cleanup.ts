// Runs the outbox retention cleanup by hand (the same code as /api/cron/cleanup-notifications).
// Prints counts only. Dry run by default: counts what would be removed and deletes nothing.
//
// Usage (from the project root):
//   npx tsx --env-file=.env.local scripts/run-cleanup.ts            dry run
//   npx tsx --env-file=.env.local scripts/run-cleanup.ts --apply    delete, and write the audit entry

import { createServiceClient } from '../lib/supabase/server'
import { OUTBOX_RETENTION_DAYS, auditCleanupRun, purgeOldNotifications } from '../lib/notify-retention'

async function main() {
  const args = process.argv.slice(2)
  if (args.some(a => a !== '--apply')) {
    console.error('Usage: scripts/run-cleanup.ts [--apply]')
    process.exitCode = 1
    return
  }
  const apply = args.includes('--apply')
  const admin = createServiceClient()

  console.log(`Retention: sent ${OUTBOX_RETENTION_DAYS.sent} days, dead ${OUTBOX_RETENTION_DAYS.dead} days (since the last update)`)
  console.log(apply ? 'Mode: APPLY (rows are deleted)' : 'Mode: dry run (nothing is deleted)')
  const counts = await purgeOldNotifications(admin, { apply })
  console.log(`${apply ? 'Removed' : 'Would remove'}: ${counts.sent} sent, ${counts.dead} dead`)
  if (apply) console.log(await auditCleanupRun(admin, counts) ? 'Audit entry written.' : 'No active HR account to file the audit entry under: none written.')
}

main().catch(e => { console.error(e instanceof Error ? e.message : 'The cleanup failed.'); process.exitCode = 1 })
