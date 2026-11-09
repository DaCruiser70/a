// Checks the notification dispatcher end to end against the real database, without sending mail.
// Prints PASS/FAIL lines and counts only: never an address, a subject, a body or a secret.
//
// Needs 20261103_notification_dispatch.sql to have been run. Runs in console mode only (it refuses
// otherwise), and every dispatcher run here is limited to the rows this script creates, which are
// deleted at the end. Real queued notifications are never claimed. Safe to re-run.
//
// The project-management checks also create a temporary hire (an @example.com account that nobody
// can sign in to) and temporary active team rows for a few seconds, removed at the end. Do not run
// this against a database while a live cron run could pick up its queued rows.
//
// Usage (from the project root):
//   bash:        EMAIL_MODE=console npx tsx --env-file=.env.local scripts/test-notifications.ts
//   PowerShell:  $env:EMAIL_MODE='console'; npx tsx --env-file=.env.local scripts/test-notifications.ts
// (A variable already set in the shell wins over the same one in .env.local.)

import { randomBytes } from 'node:crypto'
import { createServiceClient } from '../lib/supabase/server'
import { queueNotification, hrNotifyEmails, dueNow } from '../lib/notify'
import { dispatchNotifications, mergeRecipients, resolveRecipients, type Recipient } from '../lib/notify-dispatch'
import { pmHeldInOtherRegion, pmRequestInRegion, pmRequestsInRegion, syncPmRequest } from '../lib/pm-server'
import { pmGreetingName, pmRegionWarnings } from '../lib/pm'
import { EMPTY_PLAN, PlanPutSchema, fieldErrors } from '../lib/manager-plan'
import { mailConfig, mailerCanDeliver, planNotice, graphMessage, sendNotice, type NoticeHooks, type NoticeMessage, type NoticeResult } from '../lib/mailer'
import { noticeEmail } from '../lib/email-templates'
import { GET as cronGET } from '../app/api/cron/dispatch-notifications/route'

const admin = createServiceClient()
const runId = randomBytes(6).toString('hex')
const created: string[] = []
let tempHireId: string | null = null
let tempTeamIds: string[] = []
let passed = 0
let failed = 0

function check(name: string, ok: boolean) {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// A test row: "all forms received" (audience HR, so no hire account is involved), no hire
async function makeRow(label: string): Promise<string> {
  const version = `selftest-${runId}-${label}`
  await queueNotification({ template: 'onboarding_complete', hireId: null, payload: {}, version })
  const { data } = await admin.from('notification_outbox').select('id').like('dedupe_key', `%:${version}`).single()
  if (!data) throw new Error('test row was not created')
  created.push(data.id)
  return data.id
}

async function rowOf(id: string) {
  const { data } = await admin.from('notification_outbox').select('*').eq('id', id).single()
  if (!data) throw new Error('test row disappeared')
  return data
}

// A stand-in for the mailer that behaves like live mode (one message per recipient, honouring the
// hooks) and only counts. Nothing leaves this process.
function countingSender(delayMs = 0) {
  const deliveries: string[] = []
  const send = async (msg: NoticeMessage, hooks: NoticeHooks): Promise<NoticeResult> => {
    if (delayMs) await sleep(delayMs)
    for (const to of msg.recipients) {
      if (await hooks.isDone?.(to)) continue
      const gate = await hooks.beforeSend?.(to)
      if (gate && !gate.ok) return { outcome: 'deferred', retryAfterSeconds: gate.retryAfterSeconds }
      deliveries.push(to.toLowerCase())
      await hooks.afterSend?.(to)
    }
    return { outcome: 'sent' }
  }
  return { send, deliveries }
}

async function main() {
  const config = mailConfig()
  if (!config.ready || config.mode !== 'console' || process.env.NODE_ENV === 'production') {
    console.error('Refusing to run: set EMAIL_MODE=console (see the usage notes at the top of this file).')
    process.exit(1)
  }
  const hrCount = hrNotifyEmails().length
  console.log(`HR_NOTIFY_EMAILS addresses: ${hrCount}`)

  // 1. The same event queued twice: one row
  {
    const version = `selftest-${runId}-dedupe`
    const first  = await queueNotification({ template: 'onboarding_complete', hireId: null, payload: {}, version })
    const second = await queueNotification({ template: 'onboarding_complete', hireId: null, payload: {}, version })
    const { data } = await admin.from('notification_outbox').select('id').like('dedupe_key', `%:${version}`)
    created.push(...(data ?? []).map(r => r.id))
    check('same event queued twice → one row', first === true && second === false && (data?.length ?? 0) === 1)
  }

  // 2. No address stored anywhere in a row
  {
    const id  = await makeRow('noaddr')
    const row = await rowOf(id)
    check('outbox row holds no address', !JSON.stringify(row).includes('@') && !('to_emails' in row))
  }

  // 3. Two dispatcher runs at the same time: sent once
  {
    const id = await makeRow('race')
    const sender = countingSender(300)
    const [a, b] = await Promise.all([
      dispatchNotifications({ onlyIds: [id], deps: { send: sender.send } }),
      dispatchNotifications({ onlyIds: [id], deps: { send: sender.send } }),
    ])
    const row = await rowOf(id)
    check('two runs at once → claimed by one run only', a.claimed + b.claimed === 1)
    check('two runs at once → each recipient sent once', sender.deliveries.length === hrCount && new Set(sender.deliveries).size === hrCount)
    check('two runs at once → row is sent', row.status === 'sent' && !!row.sent_at)
  }

  // 4. Provider failure: retried with backoff, dead after 5
  {
    const id = await makeRow('fail')
    const failing = async (): Promise<NoticeResult> => ({ outcome: 'failed', error: 'network' })
    const expected = [60, 300, 1800, 7200]
    let backoffOk = true
    let statusOk  = true
    for (let attempt = 1; attempt <= 5; attempt++) {
      const run = await dispatchNotifications({ onlyIds: [id], deps: { send: failing } })
      const row = await rowOf(id)
      // Statuses, counts and a fixed error code only
      const want = `status=${attempt < 5 ? 'failed' : 'dead'} attempts=${attempt} error_code=network delay=${attempt < 5 ? expected[attempt - 1] : 'n/a'}`
      const got  = `status=${row.status} attempts=${row.attempts} error_code=${row.last_error} delay=${Math.round((new Date(row.send_after).getTime() - Date.now()) / 1000)}`
      console.log(`      attempt ${attempt}: claimed=${run.claimed}\n        expected ${want}\n        got      ${got}`)
      if (row.attempts !== attempt || row.last_error !== 'network') statusOk = false
      if (attempt < 5) {
        if (row.status !== 'failed') statusOk = false
        // Both timestamps come from the database's clock, so this machine's clock plays no part
        const wait = (new Date(row.send_after).getTime() - new Date(row.updated_at).getTime()) / 1000
        if (Math.abs(wait - expected[attempt - 1]) > 3) backoffOk = false
        // Make it due again so the next attempt runs
        await admin.from('notification_outbox').update({ send_after: dueNow() }).eq('id', id)
      } else if (row.status !== 'dead') {
        statusOk = false
      }
    }
    check('provider failure → failed, attempts counted, error code stored', statusOk)
    check('provider failure → backoff 1 min, 5 min, 30 min, 2 h', backoffOk)
    // Due, so only its 'dead' status can keep it from being claimed
    await admin.from('notification_outbox').update({ send_after: dueNow() }).eq('id', id)
    const again = await dispatchNotifications({ onlyIds: [id], deps: { send: failing } })
    check('dead row is never claimed again', again.claimed === 0)
  }

  // 5. A row stuck in 'sending' over 10 minutes goes back and is sent; a recent one is left alone
  {
    const stuck  = await makeRow('stuck')
    const recent = await makeRow('recent')
    await admin.from('notification_outbox').update({ status: 'sending', claimed_at: new Date(Date.now() - 11 * 60_000).toISOString() }).eq('id', stuck)
    await admin.from('notification_outbox').update({ status: 'sending', claimed_at: new Date(Date.now() - 2 * 60_000).toISOString() }).eq('id', recent)
    const sender = countingSender()
    await dispatchNotifications({ onlyIds: [stuck, recent], deps: { send: sender.send } })
    check('stuck sending row (11 min) recovers and is sent', (await rowOf(stuck)).status === 'sent')
    check('recent sending row (2 min) is left alone', (await rowOf(recent)).status === 'sending')
  }

  // 6. A person reached through two roles gets one email
  {
    const merged = mergeRecipients([
      { email: 'person.one@example.com', audience: 'hr' },
      { email: 'Person.One@example.com', audience: 'payroll' },
      { email: 'person.two@example.com', audience: 'payroll' },
    ])
    check('merge: two roles, one person → one address', merged.emails.length === 2)
    check('merge: labels name both roles', merged.labels.join(', ') === 'HR, Payroll')

    const id = await makeRow('tworoles')
    const sender = countingSender()
    const resolve = async (): Promise<Recipient[]> => [
      { email: 'person.one@example.com', audience: 'hr' },
      { email: 'PERSON.ONE@example.com', audience: 'payroll' },
    ]
    await dispatchNotifications({ onlyIds: [id], deps: { send: sender.send, resolve } })
    check('dispatch: person with two roles gets one email', sender.deliveries.length === 1)
  }

  // 7. Test mode: one message, to the test mailbox only, "[TEST → …]" and "Would have gone to:"
  {
    const content = noticeEmail('hire_approved', {
      hireName: 'Priya Nair', firstName: '', startDate: null, section: null, taskNames: [], link: 'https://example.com/payroll/dashboard',
    })
    const testBox = 'test.inbox@example.com'
    const real    = ['payroll.one@example.com', 'manager.one@example.com']
    const single  = planNotice('test', testBox, { recipients: [real[0]], audienceLabels: ['Payroll'], ...content })
    check('test mode: subject "[TEST → Payroll] Ready for payroll: Priya Nair"', single[0]?.subject === '[TEST → Payroll] Ready for payroll: Priya Nair')

    const plan = planNotice('test', testBox, { recipients: real, audienceLabels: ['HR', 'Manager'], ...content })
    check('test mode: several recipients → one message', plan.length === 1)
    check('test mode: subject lists the roles', plan[0]?.subject.startsWith('[TEST → HR, Manager] ') === true)
    check('test mode: text starts with "Would have gone to:" and the real list', plan[0]?.text.startsWith(`Would have gone to: ${real.join(', ')}\n`) === true)
    check('test mode: HTML shows "Would have gone to:" at the top of the body', /<body[^>]*>\s*<div[^>]*>Would have gone to: /.test(plan[0]?.html ?? ''))

    const graph = plan.map(d => graphMessage(d.to, d.subject, d.html, true))
    const posted = JSON.stringify(graph)
    const onlyTestBox = graph.every(g => g.message.toRecipients.length === 1 && g.message.toRecipients[0].emailAddress.address === testBox)
    const noCopies = !/ccRecipients|bccRecipients|replyTo/i.test(posted)
    const realOnlyInBody = graph.every(g => !real.some(r => g.message.toRecipients.some(t => t.emailAddress.address === r)))
    check('test mode: the only recipient is EMAIL_TEST_RECIPIENT (no real address, no cc, no bcc)', onlyTestBox && noCopies && realOnlyInBody)
    check('test mode: no test mailbox configured → nothing planned', planNotice('test', null, { recipients: real, audienceLabels: ['HR'], ...content }).length === 0)
    check('live mode: one message per real recipient', planNotice('live', null, { recipients: real, audienceLabels: ['HR'], ...content }).length === 2)
  }

  // 8. Templates escape names
  {
    const content = noticeEmail('onboarding_complete', {
      hireName: '<script>alert(1)</script> & "x"', firstName: '', startDate: null, section: null, taskNames: [], link: 'https://example.com/hr/dashboard',
    })
    check('templates escape user text', !content.html.includes('<script>') && content.html.includes('&lt;script&gt;'))
  }

  // 9. Console mode sends nothing; production without EMAIL_MODE refuses
  {
    const msg = { recipients: ['person.one@example.com'], audienceLabels: ['HR'], subject: 's', html: '<p>h</p>', text: 't' }
    check('console mode: sendNotice only logs', (await sendNotice(msg)).outcome === 'logged')
    check('console mode: dispatcher claims nothing', (await dispatchNotifications({ onlyIds: [created[0]] })).skipped === 'email_off')

    const env = process.env as Record<string, string | undefined>
    const saved = { NODE_ENV: env.NODE_ENV, EMAIL_MODE: env.EMAIL_MODE }
    env.NODE_ENV = 'production'
    delete env.EMAIL_MODE
    try {
      check('production without EMAIL_MODE: not configured', !mailConfig().ready && !mailerCanDeliver())
      check('production without EMAIL_MODE: sendNotice refuses', (await sendNotice(msg)).outcome === 'not_configured')
      check('production without EMAIL_MODE: dispatcher claims nothing', (await dispatchNotifications({ onlyIds: [created[0]] })).skipped === 'email_off')
    } finally {
      env.NODE_ENV = saved.NODE_ENV
      if (saved.EMAIL_MODE === undefined) delete env.EMAIL_MODE
      else env.EMAIL_MODE = saved.EMAIL_MODE
    }
  }

  // 10. Cron route: 401 without the secret and with a wrong one
  {
    const env = process.env as Record<string, string | undefined>
    const savedSecret = env.CRON_SECRET
    if (!savedSecret) env.CRON_SECRET = randomBytes(32).toString('hex')
    try {
      const url = 'http://localhost/api/cron/dispatch-notifications'
      const none  = await cronGET(new Request(url))
      const wrong = await cronGET(new Request(url, { headers: { Authorization: `Bearer ${randomBytes(32).toString('hex')}` } }))
      check('cron: no secret → 401', none.status === 401)
      check('cron: wrong secret → 401', wrong.status === 401)
      const noneBody = JSON.stringify(await none.json())
      check('cron: 401 says nothing more', noneBody === '{"error":"Unauthorized"}')
      // Console mode, so a correct call claims nothing
      const right = await cronGET(new Request(url, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } }))
      check('cron: right secret → 200 (console mode, nothing sent)', right.status === 200)
    } finally {
      if (savedSecret === undefined) delete env.CRON_SECRET
    }
  }

  await testPmRouting()
}

// Project-management routing: the plan's project region alone decides the team. The hire's own
// region is deliberately Ontario throughout, so any use of it would fail these checks.
async function testPmRouting() {
  const NB = 'New Brunswick' as const
  const ON = 'Ontario' as const

  const { data: manager } = await admin.from('managers').select('id').limit(1).single()
  if (!manager) throw new Error('no manager row to test with')

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: `selftest-${runId}@example.com`, password: randomBytes(32).toString('base64url'), email_confirm: true,
    app_metadata: { role: 'newhire', roles: ['newhire'] }, user_metadata: { full_name: 'Selftest Hire' },
  })
  if (authError || !authUser.user) throw new Error('could not create the test hire')
  tempHireId = authUser.user.id
  const hireId = authUser.user.id
  await admin.from('profiles').update({ role: 'newhire', roles: ['newhire'], region: ON }).eq('id', hireId)

  const { data: team, error: teamError } = await admin.from('region_teams').insert([
    { region: NB, member_name: `Selftest NB ${runId}`, member_email: `selftest-nb-${runId}@example.com` },
    { region: ON, member_name: `Selftest ON ${runId}`, member_email: `selftest-on-${runId}@example.com` },
  ]).select('id, region, member_email')
  if (teamError || !team) throw new Error('could not create the test team rows')
  tempTeamIds = team.map(m => m.id)
  const nbMember = team.find(m => m.region === NB)!
  const onMember = team.find(m => m.region === ON)!

  const { error: planError } = await admin.from('manager_plans').insert({
    newhire_id: hireId, manager_id: manager.id, status: 'submitted', clearance_type: 'pspc_rcmp', project_number: 'SELFTEST', project_region: null,
  })
  if (planError) throw new Error('could not create the test plan')

  const actor = { by: null, label: 'Manager' } as const
  const setPlanRegion = (region: string | null) => admin.from('manager_plans')
    .update({ project_region: region as typeof NB | null }).eq('newhire_id', hireId)
  const request = async () => (await admin.from('pm_requests').select('status, region, claimed_by').eq('newhire_id', hireId).maybeSingle()).data
  const notices = async () => (await admin.from('notification_outbox').select('*')
    .eq('newhire_id', hireId).eq('template', 'pm_request_created').order('created_at', { ascending: true })).data ?? []
  const audits  = async () => (await admin.from('audit_log').select('message').eq('user_id', hireId)).data?.map(a => a.message) ?? []

  // No project region: no request, no fallback to the hire's region
  check('pm: no project region → no request, no fallback', await syncPmRequest(admin, hireId, actor) === 'needs_region' && !(await request()))

  // Created in the project region
  await setPlanRegion(NB)
  const opened = await syncPmRequest(admin, hireId, actor)
  let req = await request()
  check('pm: request is created in the project region, not the hire\'s region', opened === 'open' && req?.region === NB)
  check('pm: audit written when opened', (await audits()).some(m => m.includes('opened for the') && m.includes(NB)))

  // Unclaimed moves; the notice goes to the new region only and the earlier one is kept
  const first = (await notices())[0]
  await setPlanRegion(ON)
  await syncPmRequest(admin, hireId, actor)
  req = await request()
  let rows = await notices()
  check('pm: unclaimed request moves to the new region', req?.region === ON && req?.status === 'open')
  check('pm: audit names old and new region and the trigger', (await audits()).some(m =>
    m.includes(`from <strong>${NB}</strong> to <strong>${ON}</strong>`) && m.includes('triggered by <strong>Manager</strong>')))
  check('pm: a move queues a new notice, earlier one untouched', rows.length === 2
    && rows[0].id === first.id && rows[0].dedupe_key === first.dedupe_key && rows[0].status === first.status && rows[0].payload.region === NB)
  const onTo = (await resolveRecipients(admin, rows[1], 'pm_request_created')).map(r => r.email.toLowerCase())
  check('pm: the notice goes to the new region only', rows[1].payload.region === ON
    && onTo.includes(onMember.member_email) && !onTo.includes(nbMember.member_email))
  check('pm: outbox rows hold no address', !JSON.stringify(rows).includes('@'))

  // A move back is a new notice, not swallowed; a repeat sync adds nothing
  await setPlanRegion(NB)
  await syncPmRequest(admin, hireId, actor)
  rows = await notices()
  check('pm: moving back to a region is not swallowed by the dedupe key', rows.length === 3 && rows[2].payload.region === NB)
  await syncPmRequest(admin, hireId, actor)
  check('pm: syncing again changes nothing', (await notices()).length === 3)

  // Team members only see their own region
  const seen = async (region: typeof NB | typeof ON, memberId: string) => ({
    one:  !!(await pmRequestInRegion(admin, region, hireId)),
    list: ((await pmRequestsInRegion(admin, { region, memberId, tab: 'open', limit: 100, offset: 0 })).data ?? []).some(r => r.newhire_id === hireId),
  })
  const nbSeesNb = await seen(NB, nbMember.id)
  const onSeesNb = await seen(ON, onMember.id)
  check('pm: NB member sees an NB request (detail and Open list)', nbSeesNb.one && nbSeesNb.list)
  check('pm: Ontario member cannot see an NB request', !onSeesNb.one && !onSeesNb.list)

  // Claimed stays and flags, with no notice
  await admin.from('pm_requests').update({ status: 'claimed', claimed_by: nbMember.id, claimed_at: new Date().toISOString() }).eq('newhire_id', hireId)
  await setPlanRegion(ON)
  const held = await syncPmRequest(admin, hireId, actor)
  req = await request()
  check('pm: claimed request stays where it is, still claimed', held === 'claimed' && req?.region === NB && req?.claimed_by === nbMember.id)
  check('pm: claimed request queues no notice', (await notices()).length === 3)
  const warnings = pmRegionWarnings(req, ON, 1)
  check('pm: HR is warned the plan and request no longer match', warnings.length === 1 && warnings[0].includes(ON) && warnings[0].includes(NB))
  check('pm: held-in-other-region is detected for the audit', await pmHeldInOtherRegion(admin, hireId, ON))

  // Released: it can move now
  await admin.from('pm_requests').update({ status: 'open', claimed_by: null, claimed_at: null }).eq('newhire_id', hireId)
  await syncPmRequest(admin, hireId, actor)
  req = await request()
  check('pm: after release the request moves to the plan\'s region', req?.region === ON && (await notices()).length === 4)
  const nbSeesOn = await seen(NB, nbMember.id)
  const onSeesOn = await seen(ON, onMember.id)
  check('pm: NB member cannot see an Ontario request', !nbSeesOn.one && !nbSeesOn.list)
  check('pm: Ontario member sees an Ontario request', onSeesOn.one && onSeesOn.list)

  // Done never moves
  await admin.from('pm_requests').update({ status: 'done', completed_by: onMember.id, completed_at: new Date().toISOString() }).eq('newhire_id', hireId)
  await setPlanRegion(NB)
  check('pm: a done request never moves', await syncPmRequest(admin, hireId, actor) === 'done' && (await request())?.region === ON)

  // Empty team
  check('pm: empty team warns HR', pmRegionWarnings({ status: 'open', region: NB }, NB, 0).includes(`No active team for ${NB}`))
  check('pm: a team with members does not warn', pmRegionWarnings({ status: 'open', region: NB }, NB, 1).length === 0)

  // Plan validation: required, and only from the shared list
  const plan = (project_region: string) => ({ action: 'submit', plan: {
    ...EMPTY_PLAN, clearance_type: 'pspc_rcmp', project_number: 'P1', project_region,
    schedule_wk1_2: 'a', schedule_wk2_3: 'a', schedule_wk3_4: 'a', schedule_month2: 'a', schedule_month3: 'a',
  } })
  const regionError = (body: unknown) => {
    const r = PlanPutSchema.safeParse(body)
    return r.success ? null : fieldErrors(r.error).project_region ?? null
  }
  check('plan: a listed region is accepted', regionError(plan(NB)) === null && PlanPutSchema.safeParse(plan(NB)).success)
  check('plan: missing region is rejected with a clear message', regionError(plan('')) === 'Choose the project region.')
  check('plan: free text is rejected', ['new brunswick', 'New Brunswick ', 'NB', 'Quebec'].every(v => regionError(plan(v)) === 'Choose the project region from the list.'))
  check('plan: free text is rejected on a draft too', !PlanPutSchema.safeParse({ ...plan('NB'), action: 'draft' }).success)

  // Greeting
  check('greeting: team name is shown whole', pmGreetingName('New Brunswick Team') === 'New Brunswick Team' && pmGreetingName('New Brunswick') === 'New Brunswick')
  check('greeting: a person gets their first name', pmGreetingName('Jane Doe') === 'Jane')
}

main()
  .catch(e => { failed++; console.error(`FAIL  the test run stopped early: ${e instanceof Error ? e.message : 'unknown'}`) })
  .finally(async () => {
    if (created.length) await admin.from('notification_outbox').delete().in('id', created)
    // Deleting the hire removes its profile, plan, request, notices and audit entries; the team rows
    // can only go once the request that references them is gone
    if (tempHireId) await admin.auth.admin.deleteUser(tempHireId)
    if (tempTeamIds.length) await admin.from('region_teams').delete().in('id', tempTeamIds)
    console.log(`\n${passed} passed, ${failed} failed. Test rows removed: ${created.length}, temporary hire: ${tempHireId ? 1 : 0}, temporary team rows: ${tempTeamIds.length}`)
    process.exit(failed ? 1 : 0)
  })
