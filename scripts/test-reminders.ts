// Tests for the daily reminders (E4). Prints PASS/FAIL lines and counts only: never an address, a
// name or a secret.
//
// !! Do NOT run this while a live cron is on for this database. !!
// It creates temporary @example.com accounts (a hire, a stakeholder, a manager), temporary active
// project-management team rows, a task, a plan and a request, queues reminders for those temporary
// people only, briefly turns the global "Pause reminders" switch on and back off, and removes all of
// it at the end. A live cron run during the test could send its rows or see the switch paused.
//
// Needs 20261103_notification_dispatch.sql and 20261109_reminder_settings.sql. Runs in console mode
// only (it refuses otherwise); nothing is ever sent.
//
// Usage (from the project root):
//   bash:        EMAIL_MODE=console npx tsx --env-file=.env.local scripts/test-reminders.ts
//   PowerShell:  $env:EMAIL_MODE='console'; npx tsx --env-file=.env.local scripts/test-reminders.ts

import { randomBytes } from 'node:crypto'
import { createServiceClient } from '../lib/supabase/server'
import { businessDaysBetween, isBusinessDay } from '../lib/business-days'
import {
  CADENCE, groupByPerson, planFromSnapshot, reminderRunDue, runDailyReminders, loadHistory,
  type History, type PersonGroup, type ReminderPlan, type Snapshot,
} from '../lib/reminders'
import { isHireDone, sentItemCount } from '../lib/reminders-render'
import { computeDocumentsItem, computeHireStatus } from '../lib/hire-status'
import { requiredDocumentSlots } from '../lib/required-documents'
import { readReminderSettings, setRemindersPaused } from '../lib/reminder-settings'
import { dedupeKeyFor } from '../lib/notify'
import { dispatchNotifications, personKey } from '../lib/notify-dispatch'
import { mailConfig, planNotice, type NoticeMessage, type NoticeResult } from '../lib/mailer'
import type { ReminderTarget } from '../lib/reminder-payload'
import { GET as cronGET } from '../app/api/cron/daily-reminders/route'

const admin = createServiceClient()
const runId = randomBytes(6).toString('hex')
let passed = 0
let failed = 0
function check(name: string, ok: boolean) {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

// ── Pure helpers ──

const H1 = '11111111-1111-4111-8111-111111111111'
const H2 = '22222222-2222-4222-8222-222222222222'
const H3 = '33333333-3333-4333-8333-333333333333'
const S1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const N1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const N2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const O1 = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const P1 = '44444444-4444-4444-8444-444444444444'
const T1 = '55555555-5555-4555-8555-555555555555'
const T2 = '66666666-6666-4666-8666-666666666666'
const HRK = '0123456789abcdef0123456789abcdef'

const empty = (): Snapshot => ({ hires: [], tasks: [], plans: [], pm: [], teams: {}, payroll: [], payrollAccounts: [], hrMailboxes: [HRK], dead: 0 })

function nextDay(d: string): string {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + 1)
  return x.toISOString().slice(0, 10)
}

// Plays each business day from `from` to `to`, recording what was queued as history (like the real
// run does), and returns the dates on which `pick` matched a target
function simulate(snap: Snapshot, from: string, to: string, pick: (p: ReminderPlan) => boolean): { dates: string[]; history: History } {
  const history: History = new Map()
  const dates: string[] = []
  for (let d = from; d <= to; d = nextDay(d)) {
    if (!isBusinessDay(d)) continue
    const plan = planFromSnapshot(snap, d, history)
    if (pick(plan)) dates.push(d)
    for (const t of plan.targets) for (const ref of t.refs) history.set(ref, [...(history.get(ref) ?? []), d])
  }
  return { dates, history }
}
const has = (kind: ReminderTarget['kind'], test: (p: ReminderPlan['targets'][number]) => boolean = () => true) =>
  (p: ReminderPlan) => p.targets.some(t => t.target.kind === kind && test(t))
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

function pureTests() {
  // Business days
  check('days: weekend skipped (Fri 2026-11-13 → Wed 11-18 is 3)', businessDaysBetween('2026-11-13', '2026-11-18') === 3)
  check('days: holidays skipped (Thu 2026-12-24 → Thu 12-31 is 3)', businessDaysBetween('2026-12-24', '2026-12-31') === 3)
  check('days: Saturday, Christmas and observed Boxing Day are not business days',
    !isBusinessDay('2026-11-14') && !isBusinessDay('2026-12-25') && !isBusinessDay('2026-12-28') && isBusinessDay('2026-12-29'))

  // Cron hour: 9 o'clock Toronto on a business day, winter and summer
  check('cron: 14:00 UTC in winter is 9:00 Toronto → due', reminderRunDue(new Date('2026-11-10T14:00:00Z')).due)
  check('cron: 13:00 UTC in winter is 8:00 Toronto → not due', !reminderRunDue(new Date('2026-11-10T13:00:00Z')).due)
  check('cron: 13:00 UTC in summer is 9:00 Toronto → due', reminderRunDue(new Date('2027-07-06T13:00:00Z')).due)
  check('cron: 14:00 UTC in summer is 10:00 Toronto → not due', !reminderRunDue(new Date('2027-07-06T14:00:00Z')).due)
  check('cron: Saturday and holidays → not due', !reminderRunDue(new Date('2026-11-14T14:00:00Z')).due && !reminderRunDue(new Date('2026-11-11T14:00:00Z')).due)

  // 1a. Hire not finished: day 3, then every 3, at most 4
  const unfinished = empty()
  unfinished.hires = [{ id: H1, at: '2027-01-04', unfinished: true, flagged: [] }]
  const a = simulate(unfinished, '2027-01-04', '2027-02-26', has('hire', t => !!t.sections.hire?.unfinished))
  check('hire not finished: business days 3, 6, 9, 12 and then stops at 4', same(a.dates, ['2027-01-07', '2027-01-12', '2027-01-15', '2027-01-20']))
  check('hire not finished: "needs a call" in the HR digest after the 4th', planFromSnapshot(unfinished, '2027-01-21', a.history).digest?.needsCall.includes(H1) === true
    && !planFromSnapshot(unfinished, '2027-01-20', new Map([...a.history].map(([k, v]) => [k, v.filter(d => d < '2027-01-20')]))).digest?.needsCall.length)
  const finished = empty()
  finished.hires = [{ id: H1, at: '2027-01-04', unfinished: false, flagged: [] }]
  check('hire not finished: stops once everything is sent', simulate(finished, '2027-01-04', '2027-02-26', has('hire')).dates.length === 0)
  check('hire not finished: an approved hire or one in the payroll queue gets nothing', isHireDone({ status: 'approved', enteredPayroll: null }) && isHireDone({ status: 'needs-review', enteredPayroll: '2027-01-05T00:00:00Z' }) && !isHireDone({ status: 'flagged', enteredPayroll: null }))
  // "N of 5": what the hire has completed and sent, never what HR has approved
  const allDocs = requiredDocumentSlots({}).map(s => ({ document_type: s.types[0], form_status: 'review' }))
  const waiting4 = computeHireStatus(['review', 'review', 'review', 'review'], [], {})
  check('N of 5: four forms sent and waiting on HR read 4 of 5, not 0', sentItemCount(['review', 'review', 'review', 'review'], computeDocumentsItem([], {})) === 4 && waiting4.approvedCount === 0)
  check('N of 5: all four forms and every document sent read 5 of 5', sentItemCount(['review', 'approved', 'flagged', 'review'], computeDocumentsItem(allDocs, {})) === 5)
  check('N of 5: Documents count only when every required slot has an upload', allDocs.length > 1
    && sentItemCount(['pending', 'pending', 'pending', 'pending'], computeDocumentsItem(allDocs.slice(0, 1), {})) === 0)
  check('N of 5: nothing sent reads 0 of 5', sentItemCount([null, 'pending', undefined, 'pending'], computeDocumentsItem([], {})) === 0)

  const holiday = empty()
  holiday.hires = [{ id: H1, at: '2026-12-24', unfinished: true, flagged: [] }]
  check('hire not finished: across Christmas the first reminder is 2026-12-31', simulate(holiday, '2026-12-24', '2027-01-04', has('hire')).dates[0] === '2026-12-31')

  // 1b. Flagged: day 2, then every 3, at most 3
  const flagged = empty()
  flagged.hires = [{ id: H1, at: '2026-12-01', unfinished: false, flagged: [{ form: 'banking', at: '2027-01-05' }] }]
  const f = simulate(flagged, '2027-01-05', '2027-02-26', has('hire', t => (t.sections.hire?.flagged.length ?? 0) > 0))
  check('flagged form: business days 2, 5, 8 and then stops at 3', same(f.dates, ['2027-01-07', '2027-01-12', '2027-01-15']))
  const both = empty()
  both.hires = [{ id: H1, at: '2027-01-04', unfinished: true, flagged: [{ form: 'sin', at: '2027-01-05' }] }]
  const bothPlan = planFromSnapshot(both, '2027-01-07', new Map())
  check('hire: not-finished and flagged merge into one email for the hire', bothPlan.targets.filter(t => t.target.kind === 'hire').length === 1
    && bothPlan.targets[0].sections.hire?.unfinished === true && bothPlan.targets[0].sections.hire?.flagged.join() === 'sin')

  // 2. Stakeholder: open more than 3 business days, then every 3, at most 3; merged per person
  const tasks = empty()
  tasks.tasks = [{ id: T1, hireId: H1, assigneeId: S1, at: '2027-01-04' }, { id: T2, hireId: H2, assigneeId: S1, at: '2027-01-04' }]
  const t = simulate(tasks, '2027-01-04', '2027-02-26', has('stakeholder'))
  check('stakeholder: business days 4, 7, 10 and then stops at 3', same(t.dates, ['2027-01-08', '2027-01-13', '2027-01-18']))
  const tp = planFromSnapshot(tasks, '2027-01-08', new Map())
  check('stakeholder: two open tasks for one person are one email', tp.targets.filter(x => x.target.kind === 'stakeholder').length === 1
    && tp.targets[0].sections.tasks?.length === 2)

  // 3. Manager: day 3, then every 3, at most 3; one email per manager; follows reassignment
  const plans = empty()
  plans.plans = [{ hireId: H1, managerId: MA, seq: 1, at: '2027-01-04' }, { hireId: H2, managerId: MA, seq: 1, at: '2027-01-04' }]
  const m = simulate(plans, '2027-01-04', '2027-02-26', has('manager'))
  check('manager: business days 3, 6, 9 and then stops at 3', same(m.dates, ['2027-01-07', '2027-01-12', '2027-01-15']))
  const mp = planFromSnapshot(plans, '2027-01-07', new Map())
  check('manager: two hires waiting are one email listing both', mp.targets.filter(x => x.target.kind === 'manager').length === 1 && mp.targets[0].sections.plans?.length === 2)
  const moved = empty()
  moved.plans = [{ hireId: H1, managerId: MB, seq: 2, at: '2027-01-18' }]
  const mv = planFromSnapshot(moved, '2027-01-21', m.history)
  check('manager: after reassignment the new manager is reminded, the old one is not', mv.targets.length > 0
    && mv.targets.every(x => x.target.kind !== 'manager' || x.target.id === MB) && mv.targets.some(x => x.target.kind === 'manager' && x.target.id === MB))

  // 4. Project management: only the request's region; claimed only to the claimer; empty team → digest
  const pm = empty()
  pm.teams = { 'New Brunswick': [N1, N2], Ontario: [O1] }
  pm.pm = [
    { hireId: H1, region: 'New Brunswick', status: 'open', at: '2027-01-04', claimedBy: null },
    { hireId: H2, region: 'Ontario', status: 'claimed', at: '2027-01-04', claimedBy: O1 },
    { hireId: H3, region: 'Nova Scotia', status: 'open', at: '2027-01-04', claimedBy: null },
  ]
  const pp = planFromSnapshot(pm, '2027-01-07', new Map())
  const pmTargets = pp.targets.filter(x => x.target.kind === 'pm_member')
  const forHire = (id: string) => pmTargets.filter(x => [...(x.sections.pmOpen ?? []), ...(x.sections.pmClaimed ?? [])].some(i => i.hireId === id))
  check('pm: unclaimed NB request reaches both NB members and nobody else', forHire(H1).map(x => x.target.kind === 'pm_member' ? x.target.id : '').sort().join() === [N1, N2].sort().join())
  check('pm: a New Brunswick request never reaches Ontario', forHire(H1).every(x => x.target.kind === 'pm_member' && x.target.region === 'New Brunswick'))
  check('pm: an Ontario request never reaches New Brunswick', forHire(H2).every(x => x.target.kind === 'pm_member' && x.target.region === 'Ontario'))
  check('pm: a claimed request reaches only the claimer', forHire(H2).length === 1 && forHire(H2)[0].target.kind === 'pm_member' && (forHire(H2)[0].target as { id: string }).id === O1)
  check('pm: empty team sends nothing and goes to the HR digest', forHire(H3).length === 0 && pp.digest?.noTeam.join() === 'Nova Scotia')
  const po = empty()
  po.teams = { 'New Brunswick': [N1] }
  po.pm = [{ hireId: H1, region: 'New Brunswick', status: 'open', at: '2027-01-04', claimedBy: null }]
  check('pm: unclaimed business days 2, 5, 8 and then stops at 3', same(simulate(po, '2027-01-04', '2027-02-26', has('pm_member')).dates, ['2027-01-06', '2027-01-11', '2027-01-14']))
  const pc = empty()
  pc.teams = { 'New Brunswick': [N1] }
  pc.pm = [{ hireId: H1, region: 'New Brunswick', status: 'claimed', at: '2027-01-04', claimedBy: N1 }]
  const pcs = simulate(pc, '2027-01-04', '2027-02-26', has('pm_member'))
  check('pm: claimed business days 3, 6, 9 and then stops at 3', same(pcs.dates, ['2027-01-07', '2027-01-12', '2027-01-15']))
  check('pm: a request at its limit is listed in the HR digest', planFromSnapshot(pc, '2027-01-18', pcs.history).digest?.pm.some(x => x.atLimit) === true)

  // 5. Payroll: from more than 2 business days, every business day, to every payroll account
  const pay = empty()
  pay.payroll = [{ hireId: H1, at: '2027-01-04' }]
  pay.payrollAccounts = [P1]
  const pd = simulate(pay, '2027-01-04', '2027-01-12', has('payroll'))
  check('payroll: daily from business day 3 while waiting', same(pd.dates, ['2027-01-07', '2027-01-08', '2027-01-11', '2027-01-12']))
  const k1 = dedupeKeyFor('daily_reminder', null, { person: HRK }, '2027-01-07')
  check('payroll and every reminder: one key per person per date', k1 === dedupeKeyFor('daily_reminder', null, { person: HRK }, '2027-01-07')
    && k1 !== dedupeKeyFor('daily_reminder', null, { person: HRK }, '2027-01-08') && k1.endsWith(':2027-01-07'))

  // 6. HR digest
  check('digest: zero dead notifications (after a clear) and nothing else → no digest', planFromSnapshot({ ...empty(), dead: 0 }, '2027-01-07', new Map()).digest === null
    && planFromSnapshot({ ...empty(), dead: 2 }, '2027-01-07', new Map()).digest?.dead === 2)
  check('digest: nothing to report → no digest, no email to HR', planFromSnapshot(empty(), '2027-01-07', new Map()).digest === null
    && !planFromSnapshot(empty(), '2027-01-07', new Map()).targets.some(x => x.target.kind === 'hr'))
  const full = empty()
  full.plans = plans.plans
  full.pm = pm.pm
  full.teams = pm.teams
  const fd = planFromSnapshot(full, '2027-01-07', new Map())
  check('digest: one per day per HR mailbox', fd.targets.filter(x => x.target.kind === 'hr').length === 1)
  check('digest: includes the manager and project management sections', (fd.digest?.plans.length ?? 0) === 2 && (fd.digest?.pm.length ?? 0) === 3)
}

async function groupingTests() {
  // One email per person: a stakeholder who is also a manager gets one merged email
  const plan = planFromSnapshot({ ...empty(), tasks: [{ id: T1, hireId: H1, assigneeId: S1, at: '2027-01-04' }],
    plans: [{ hireId: H2, managerId: MA, seq: 1, at: '2027-01-04' }], teams: { 'New Brunswick': [N1] },
    pm: [{ hireId: H3, region: 'New Brunswick', status: 'open', at: '2027-01-04', claimedBy: null }], hrMailboxes: [] }, '2027-01-08', new Map())
  const emailOf: Record<string, string[]> = { [S1]: ['same.person@example.com'], [MA]: ['Same.Person@example.com'], [N1]: [] }
  const { groups, unreachable } = await groupByPerson(plan.targets, async t => (t.kind === 'hr' ? [] : emailOf[t.id] ?? []), async e => e)
  check('one email per person: stakeholder + manager roles merge into one', groups.length === 1 && groups[0].to.length === 2
    && groups[0].sections.tasks?.length === 1 && groups[0].sections.plans?.length === 1)
  check('one email per person: an inactive person is skipped, not sent', unreachable === 1)
}

// ── End to end against the database ──

const tempUsers: string[] = []
const tempTeam: string[] = []
const tempManagers: string[] = []
const tempPersons: string[] = []

async function account(role: 'newhire' | 'stakeholder' | 'manager', tag: string, createdAt?: string) {
  const email = `selftest-${tag}-${runId}@example.com`
  const { data, error } = await admin.auth.admin.createUser({
    email, password: randomBytes(32).toString('base64url'), email_confirm: true,
    app_metadata: { role, roles: [role] }, user_metadata: { full_name: `Selftest ${tag}` },
  })
  if (error || !data.user) throw new Error('could not create a test account')
  tempUsers.push(data.user.id)
  await admin.from('profiles').update({ role, roles: [role], ...(createdAt ? { created_at: createdAt } : {}) } as never).eq('id', data.user.id)
  tempPersons.push(await personKey(email))
  return { id: data.user.id, email }
}

async function reminderRows() {
  if (!tempPersons.length) return []
  const { data } = await admin.from('notification_outbox').select('*').eq('template', 'daily_reminder').in('payload->>person', tempPersons)
  return data ?? []
}

async function e2eTests() {
  const settings = await readReminderSettings(admin)
  if (!settings) throw new Error('reminder_settings is missing: run 20261109_reminder_settings.sql first')
  const wasPaused = settings.paused

  const hire  = await account('newhire', 'hire', '2027-01-04T15:00:00Z')
  const stake = await account('stakeholder', 'stake')
  const mgr   = await account('manager', 'mgr')

  const { data: mrow, error: mErr } = await admin.from('managers').insert({ full_name: `Selftest Manager ${runId}`, email: mgr.email, user_id: mgr.id, active: true }).select('id').single()
  if (mErr || !mrow) throw new Error('could not create the test manager')
  tempManagers.push(mrow.id)

  const { data: team, error: tErr } = await admin.from('region_teams').insert([
    { region: 'New Brunswick', member_name: `Selftest NB1 ${runId}`, member_email: `selftest-nb1-${runId}@example.com` },
    { region: 'New Brunswick', member_name: `Selftest NB2 ${runId}`, member_email: `selftest-nb2-${runId}@example.com` },
    { region: 'Ontario',       member_name: `Selftest ON ${runId}`,  member_email: `selftest-on-${runId}@example.com` },
  ]).select('id, region, member_email')
  if (tErr || !team) throw new Error('could not create the test team')
  tempTeam.push(...team.map(x => x.id))
  for (const x of team) tempPersons.push(await personKey(x.member_email))
  const onMember = team.find(x => x.region === 'Ontario')!

  // A flagged form whose HR note must never appear anywhere
  const SECRET = `SECRET-NOTE-${runId}`
  await admin.from('policy_acknowledgements').insert({ user_id: hire.id, signature: 'x', agreed_at: '2027-01-04T15:00:00Z', form_status: 'flagged', flag_reason: SECRET, submitted_at: '2027-01-04T15:00:00Z' } as never)
  await admin.from('policy_acknowledgements').update({ updated_at: '2027-01-05T15:00:00Z' } as never).eq('user_id', hire.id)

  const { data: task } = await admin.from('stakeholder_tasks').insert({ newhire_id: hire.id, assigned_to: stake.id, task_key: 'access', task_name: 'Access Card / Key Fob', task_details: null, status: 'pending', confirmed_at: null }).select('id').single()
  await admin.from('stakeholder_tasks').update({ created_at: '2027-01-04T15:00:00Z' } as never).eq('id', task!.id)
  await admin.from('manager_plans').insert({ newhire_id: hire.id, manager_id: mrow.id, status: 'requested', created_at: '2027-01-04T15:00:00Z' } as never)
  await admin.from('pm_requests').insert({ newhire_id: hire.id, region: 'New Brunswick', status: 'open', created_at: '2027-01-04T15:00:00Z' } as never)

  const tempIds = new Set([hire.id, stake.id, mrow.id, ...tempTeam])
  // Only groups made entirely of temporary people may be queued (never a real HR, payroll or team member)
  const onlyTemp = (g: PersonGroup) => g.to.every(t => t.kind !== 'hr' && tempIds.has(t.id))
  const run = (asOf: string) => runDailyReminders(admin, { asOf, apply: true, hireIds: [hire.id], groupFilter: onlyTemp })

  if (wasPaused) await setRemindersPaused(admin, false, hire.id)
  try {
    // Day 3 (Thu 2027-01-07): hire (not finished + flagged), manager, both NB members. The task is not due until day 4.
    const r1 = await run('2027-01-07')
    const rows1 = await reminderRows()
    check('e2e: day 3 queues the hire, the manager and the two NB members', !r1.paused && r1.queued === 4 && rows1.length === 4)
    check('e2e: the Ontario member gets nothing for an NB request', !rows1.some(r => JSON.stringify(r.payload).includes(onMember.id)))
    check('e2e: the task is not due before business day 4', !rows1.some(r => JSON.stringify(r.payload).includes(task!.id)))

    // Both cron hours, or a retry: the later run sees today's reminders and queues nothing new
    const r2 = await run('2027-01-07')
    check('e2e: a second run the same day queues nothing (idempotent)', !r2.paused && r2.queued === 0 && (await reminderRows()).length === 4)

    // Stored rows: ids only
    const stored = JSON.stringify(rows1)
    check('e2e: outbox rows hold no address and no HR note', !stored.includes('@') && !stored.includes(SECRET))

    // Sent through the dispatcher: one address each; in test mode only the test mailbox
    const sent: NoticeMessage[] = []
    const capture = async (msg: NoticeMessage): Promise<NoticeResult> => { sent.push(msg); return { outcome: 'sent' } }
    await dispatchNotifications({ onlyIds: rows1.map(r => r.id), limit: 10, deps: { send: capture } })
    check('e2e: every reminder goes to exactly one person', sent.length === 4 && sent.every(m => m.recipients.length === 1))
    const box = 'test.inbox@example.com'
    const plans = sent.map(m => planNotice('test', box, m))
    check('e2e: test mode sends every reminder to EMAIL_TEST_RECIPIENT only', plans.every(p => p.length === 1 && p[0].to === box && p[0].subject.startsWith('[TEST → ')))
    const bodies = sent.map(m => `${m.subject}\n${m.html}\n${m.text}`).join('\n')
    check('e2e: no email contains the HR note or sensitive fields', !bodies.includes(SECRET) && !/date of birth|account number|transit|institution|social insurance number|licence number/i.test(bodies))
    // The temporary hire has sent one form (Policies, since flagged by HR) and nothing approved
    check('e2e: the hire email counts sent items ("1 of 5") and names the flagged form', sent.some(m => m.text.includes('Policies') && m.text.includes('completed and sent 1 of 5 onboarding steps')))

    // Outbox cleanup deletes rows, not keys: the reminder count and same-day dedupe survive it
    const keep = (await reminderRows()).map(r => ({ id: r.id, row: r }))
    const history = await loadHistory(admin)
    const refsBefore = [...history.keys()].filter(k => k.includes(hire.id)).length
    await admin.from('notification_outbox').delete().in('id', keep.map(k => k.id))
    const afterPurge = await run('2027-01-07')
    const refsAfter = [...(await loadHistory(admin)).keys()].filter(k => k.includes(hire.id)).length
    check('e2e: after an outbox cleanup, the same day queues nothing again', !afterPurge.paused && afterPurge.queued === 0 && (await reminderRows()).length === 0)
    check('e2e: after an outbox cleanup, the reminder history is intact', refsBefore > 0 && refsAfter === refsBefore)
    // Put the rows back for the checks below (as if cleanup had not run yet)
    await admin.from('notification_outbox').insert(keep.map(k => ({ ...k.row, status: 'sent' })) as never)

    // Paused: nothing queued; resumed: catches up without duplicates
    await setRemindersPaused(admin, true, hire.id)
    const r3 = await run('2027-01-08')
    check('e2e: paused → the run queues nothing', r3.paused === true && (await reminderRows()).length === 4)
    await setRemindersPaused(admin, false, hire.id)
    const r4 = await run('2027-01-11')
    const rows4 = await reminderRows()
    const taskCaught = rows4.some(r => (r.payload as { date: string }).date === '2027-01-11' && JSON.stringify(r.payload).includes(task!.id))
    check('e2e: after resuming, the missed task reminder catches up', !r4.paused && taskCaught)
    const perPersonDay = new Set(rows4.map(r => `${(r.payload as { person: string }).person}:${(r.payload as { date: string }).date}`))
    check('e2e: never more than one email per person per day', perPersonDay.size === rows4.length)
    const r5 = await run('2027-01-11')
    check('e2e: catching up twice the same day queues nothing more', !r5.paused && r5.queued === 0)

    // Two runs at the same moment (both plan before either queues): the date in the dedupe key lets
    // only one row per person through
    const [c1, c2] = await Promise.all([run('2027-01-12'), run('2027-01-12')])
    const day12 = (await reminderRows()).filter(r => (r.payload as { date: string }).date === '2027-01-12')
    const people12 = new Set(day12.map(r => (r.payload as { person: string }).person))
    check('e2e: two simultaneous runs queue each person once', !c1.paused && !c2.paused && day12.length > 0
      && people12.size === day12.length && c1.queued + c2.queued === day12.length)
  } finally {
    await setRemindersPaused(admin, wasPaused, hire.id).catch(() => {})
  }
}

async function cronTests() {
  const env = process.env as Record<string, string | undefined>
  const saved = env.CRON_SECRET
  const url = 'http://localhost/api/cron/daily-reminders'
  try {
    env.CRON_SECRET = randomBytes(32).toString('hex')
    check('cron: no secret → 401', (await cronGET(new Request(url))).status === 401)
    check('cron: wrong secret → 401', (await cronGET(new Request(url, { headers: { Authorization: `Bearer ${randomBytes(32).toString('hex')}` } }))).status === 401)
    env.CRON_SECRET = 'short-secret'
    check('cron: a short CRON_SECRET refuses even the matching header', (await cronGET(new Request(url, { headers: { Authorization: 'Bearer short-secret' } }))).status === 401)
    env.CRON_SECRET = randomBytes(32).toString('hex')
    if (reminderRunDue(new Date()).due) {
      console.log('INFO  it is 9 o\'clock on a business day in Toronto right now: the not-due check was skipped so nothing real is queued')
    } else {
      const res = await cronGET(new Request(url, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }))
      const body = await res.json() as { due?: boolean }
      check('cron: outside the 9 o\'clock hour it returns "not due" and queues nothing', res.status === 200 && body.due === false)
    }
  } finally {
    if (saved === undefined) delete env.CRON_SECRET
    else env.CRON_SECRET = saved
  }
}

async function cleanup() {
  const rows = await reminderRows()
  if (rows.length) await admin.from('notification_outbox').delete().in('id', rows.map(r => r.id))
  // This run's reminder keys (people with no hire link are not removed by deleting the accounts)
  for (const p of tempPersons) await admin.from('notification_keys').delete().like('dedupe_key', `%:person:${p}:%`)
  // Deleting the accounts removes their profile, task, plan, request, form and audit rows
  for (const id of tempUsers) await admin.auth.admin.deleteUser(id)
  if (tempManagers.length) await admin.from('managers').delete().in('id', tempManagers)
  if (tempTeam.length) await admin.from('region_teams').delete().in('id', tempTeam)
  console.log(`\nRemoved: ${rows.length} reminder rows, ${tempUsers.length} accounts, ${tempManagers.length} manager rows, ${tempTeam.length} team rows`)
}

async function main() {
  const config = mailConfig()
  if (!config.ready || config.mode !== 'console' || process.env.NODE_ENV === 'production') {
    console.error('Refusing to run: set EMAIL_MODE=console (see the usage notes at the top of this file).')
    process.exitCode = 1
    return
  }
  check('cadences as specified', CADENCE.hireUnfinished.max === 4 && CADENCE.hireFlagged.max === 3 && CADENCE.task.max === 3 && CADENCE.managerPlan.max === 3)
  pureTests()
  await groupingTests()
  try {
    await cronTests()
  } catch (e) {
    failed++
    console.error(`FAIL  the cron route tests stopped early: ${e instanceof Error ? e.message : 'unknown'}`)
  }
  try {
    await e2eTests()
  } catch (e) {
    failed++
    console.error(`FAIL  the database tests stopped early: ${e instanceof Error ? e.message : 'unknown'}`)
  } finally {
    await cleanup()
  }
  console.log(`${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

main()
