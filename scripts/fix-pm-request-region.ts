// One-time fix: re-applies the routing rule to one hire's project-management request, using
// syncPmRequest, the same code a plan save runs. An open request moves to the manager plan's project
// region, with an audit entry and a "Project details needed" notice for the new team only. A claimed
// or done request is left where it is, and so is anything that already matches. Safe to re-run.
// Prints regions, statuses and counts only.
//
// Usage (from the project root). Without --apply nothing is changed:
//   npx tsx --env-file=.env.local scripts/fix-pm-request-region.ts "Bob Wayne"
//   npx tsx --env-file=.env.local scripts/fix-pm-request-region.ts "Bob Wayne" --apply

import { createServiceClient } from '../lib/supabase/server'
import { activeRegionMembers, syncPmRequest } from '../lib/pm-server'
import { isRegion } from '../lib/pm'

async function main() {
  const args  = process.argv.slice(2)
  const apply = args.includes('--apply')
  const name  = args.find(a => !a.startsWith('--'))?.trim()
  if (!name) {
    console.error('Usage: scripts/fix-pm-request-region.ts "<full name>" [--apply]')
    process.exitCode = 1
    return
  }

  const admin = createServiceClient()
  const { data: hires, error } = await admin.from('profiles').select('id').eq('role', 'newhire').ilike('full_name', name.replace(/[%_]/g, '\\$&'))
  if (error) throw new Error(`profile lookup failed (code ${error.code})`)
  if (hires?.length !== 1) {
    console.error(`Expected exactly one new hire with that name, found ${hires?.length ?? 0}. Nothing changed.`)
    process.exitCode = 1
    return
  }
  const hireId = hires[0].id

  const read = async () => {
    const [{ data: plan }, { data: req }] = await Promise.all([
      admin.from('manager_plans').select('status, clearance_type, project_region').eq('newhire_id', hireId).maybeSingle(),
      admin.from('pm_requests').select('status, region').eq('newhire_id', hireId).maybeSingle(),
    ])
    return { plan, req }
  }

  const before = await read()
  console.log(`Plan: ${before.plan?.status ?? 'none'}, clearance ${before.plan?.clearance_type ?? 'none'}, project region ${before.plan?.project_region ?? 'not set'}`)
  console.log(`Request: ${before.req?.status ?? 'none'}, region ${before.req?.region ?? 'none'}`)
  const target = before.plan?.project_region
  if (isRegion(target)) console.log(`Active team members in ${target}: ${(await activeRegionMembers(admin, target)).length}`)

  if (!apply) {
    console.log('Dry run: nothing changed. Run again with --apply to apply the rule.')
    return
  }

  const result = await syncPmRequest(admin, hireId, { by: null, label: 'One-time fix' })
  const after  = await read()
  console.log(`After: ${result}, region ${after.req?.region ?? 'none'}`)
  console.log(after.req?.region === target ? 'The request matches the plan.' : 'The request does not match the plan (claimed, done or no project region). HR sees a warning on the card.')
}

main().catch(e => { console.error(e.message); process.exitCode = 1 })
