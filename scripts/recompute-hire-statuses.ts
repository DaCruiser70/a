// Local script: refreshes every hire's stored status and progress with computeHireStatus (the four
// forms + the Documents item). Not an HTTP route. Prints counts only — never names, emails or ids.
//
// Why: profiles.status / profiles.progress are stored when something changes, and the payroll queue
// reads profiles.status. After the Documents item became one of the 5 items, existing rows keep the
// old 4-form value until this runs (or until the hire's next form or document change).
//
// Usage (from the project root):
//   npx tsx --env-file=.env.local scripts/recompute-hire-statuses.ts --dry-run
//   npx tsx --env-file=.env.local scripts/recompute-hire-statuses.ts
//
// Safe to re-run. It never clears entered_payroll_queue_at, employee_id or payroll_completed_at:
// a hire already in the payroll queue stays there (lib/payroll-access.ts). It sets
// entered_payroll_queue_at only for a hire that is now fully approved and was never queued.

import { createClient } from '@supabase/supabase-js'
import type { Database, FormStatus, HireStatus } from '../types'
import { computeHireStatus, type HireDoc } from '../lib/hire-status'

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(name => !process.env[name])
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }
  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, status, progress, entered_payroll_queue_at')
    .eq('role', 'newhire')
  if (error) {
    console.error(`Profiles lookup failed (code ${error.code}).`)
    process.exit(1)
  }
  const ids = (profiles ?? []).map(p => p.id)
  if (ids.length === 0) { console.log('No hires.'); return }

  const [pi, bi, si, po, dc] = await Promise.all([
    admin.from('personal_info').select('user_id, form_status').in('user_id', ids),
    admin.from('banking_info').select('user_id, form_status').in('user_id', ids),
    admin.from('sin_info').select('user_id, form_status').in('user_id', ids),
    admin.from('policy_acknowledgements').select('user_id, form_status').in('user_id', ids),
    admin.from('newhire_documents').select('user_id, document_type, form_status').in('user_id', ids),
  ])
  const map = (rows: { user_id: string; form_status: string }[] | null) => Object.fromEntries((rows ?? []).map(r => [r.user_id, r.form_status]))
  const piM = map(pi.data), biM = map(bi.data), siM = map(si.data), poM = map(po.data)
  const docs: Record<string, HireDoc[]> = {}
  for (const d of dc.data ?? []) (docs[d.user_id] ??= []).push(d)

  const transitions: Record<string, number> = {}
  const counts = { hires: ids.length, changed: 0, unchanged: 0, newlyQueued: 0, leftApprovedButKeptByPayroll: 0, failures: 0 }

  for (const p of profiles ?? []) {
    const computed = computeHireStatus(
      [piM[p.id], biM[p.id], siM[p.id], poM[p.id]] as (FormStatus | undefined)[],
      docs[p.id] ?? [],
    )
    const before = (p.status ?? 'not-started') as HireStatus
    const after  = computed.status
    if (before === after && p.progress === computed.progressPct) { counts.unchanged++; continue }

    counts.changed++
    if (before !== after) transitions[`${before} → ${after}`] = (transitions[`${before} → ${after}`] ?? 0) + 1
    if (before === 'approved' && after !== 'approved' && p.entered_payroll_queue_at) counts.leftApprovedButKeptByPayroll++
    const queueNow = after === 'approved' && !p.entered_payroll_queue_at
    if (queueNow) counts.newlyQueued++

    if (!DRY_RUN) {
      const now = new Date().toISOString()
      const { error: upErr } = await admin.from('profiles')
        .update({ status: after, progress: computed.progressPct, updated_at: now, ...(queueNow ? { entered_payroll_queue_at: now } : {}) })
        .eq('id', p.id)
      if (upErr) { counts.failures++; console.error(`Update failed (code ${upErr.code}).`) }
    }
  }

  const verb = DRY_RUN ? ' (would be)' : ''
  console.log(DRY_RUN ? 'DRY RUN — nothing was written.' : 'LIVE RUN — changes written.')
  console.log(`Hires:                                 ${counts.hires}`)
  console.log(`Changed${verb}:                        ${counts.changed}`)
  console.log(`Unchanged:                             ${counts.unchanged}`)
  for (const [k, v] of Object.entries(transitions)) console.log(`  ${k}: ${v}`)
  console.log(`Left Approved, kept in payroll queue:  ${counts.leftApprovedButKeptByPayroll}`)
  console.log(`Newly queued for payroll${verb}:       ${counts.newlyQueued}`)
  console.log(`Failures:                              ${counts.failures}`)
  if (counts.failures > 0) process.exit(1)
}

main().catch(() => {
  console.error('Recompute failed unexpectedly.')
  process.exit(1)
})
