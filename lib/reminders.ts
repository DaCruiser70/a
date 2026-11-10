import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, FormStatus } from '@/types'
import { REGIONS, type Region } from '@/lib/regions'
import { businessDaysBetween, isBusinessDay, torontoDate, torontoHour } from '@/lib/business-days'
import { TOTAL_ITEMS, computeHireStatus, hasCompanyVehicle } from '@/lib/hire-status'
import { RETIRED_TASK_KEYS } from '@/lib/stakeholder-mapping'
import { queueNotification, hrNotifyEmails } from '@/lib/notify'
import { personKey, resolveTarget } from '@/lib/notify-dispatch'
import { isHireDone, sentItemCount } from '@/lib/reminders-render'
import { remindersPaused } from '@/lib/reminder-settings'
import type { FlagSection } from '@/lib/notification-templates'
import type { Digest, ReminderSections, ReminderTarget } from '@/lib/reminder-payload'

// Server only. The daily reminder run (E4). It only QUEUES daily_reminder rows in the outbox; the E3
// dispatcher sends them, with its caps and EMAIL_MODE. One row per person per day: the dedupe key is
// daily_reminder:<hire or none>:person:<HMAC of address>:<Toronto date>, so a re-run, a retry or both
// cron entries can never queue a second one.
//
// Timing: business days in America/Toronto (lib/business-days.ts), counted from the event (day 0).
// A reminder is due when elapsed >= first + every × (reminders already sent), up to max. Sent
// reminders are read back from earlier daily_reminder rows (their refs), so a paused or missed day
// is caught up later, still at most one email per person per day.

type Admin = SupabaseClient<Database>

export type Cadence = { first: number; every: number; max: number }

export const CADENCE = {
  hireUnfinished: { first: 3, every: 3, max: 4 },
  hireFlagged:    { first: 2, every: 3, max: 3 },
  task:           { first: 4, every: 3, max: 3 },   // "open more than 3 business days"
  managerPlan:    { first: 3, every: 3, max: 3 },
  pmOpen:         { first: 2, every: 3, max: 3 },
  pmClaimed:      { first: 3, every: 3, max: 3 },
} as const satisfies Record<string, Cadence>

// Payroll: every business day once a hire has waited more than 2 business days
export const PAYROLL_AFTER = 3

export function reminderDue(c: Cadence, elapsed: number, sentBefore: number): boolean {
  return sentBefore < c.max && elapsed >= c.first + c.every * sentBefore
}

// ── The day's facts (ids and Toronto dates only) ──

export type Snapshot = {
  hires:           { id: string; at: string; unfinished: boolean; flagged: { form: FlagSection; at: string }[] }[]
  tasks:           { id: string; hireId: string; assigneeId: string; at: string }[]
  plans:           { hireId: string; managerId: string; seq: number; at: string }[]
  pm:              { hireId: string; region: Region; status: 'open' | 'claimed'; at: string; claimedBy: string | null }[]
  teams:           Partial<Record<Region, string[]>>   // active region_teams ids per region
  payroll:         { hireId: string; at: string }[]
  payrollAccounts: string[]
  hrMailboxes:     string[]                             // personKey of each HR_NOTIFY_EMAILS address
  dead:            number
}

// ref → Toronto dates on which a reminder about it was queued
export type History = Map<string, string[]>

export type TargetPlan = { target: ReminderTarget; sections: ReminderSections; refs: string[] }
export type ReminderCounts = {
  hireUnfinished: number; hireFlagged: number; tasks: number; plans: number
  pmOpen: number; pmClaimed: number; payroll: number; digest: number; noTeam: number
}
export type ReminderPlan = { asOf: string; targets: TargetPlan[]; digest: Digest | null; counts: ReminderCounts }

function targetKey(t: ReminderTarget): string {
  return t.kind === 'hr' ? `hr:${t.h}` : t.kind === 'pm_member' ? `pm_member:${t.id}:${t.region}` : `${t.kind}:${t.id}`
}

// Pure: what is due today, per target, plus the HR digest
export function planFromSnapshot(snap: Snapshot, asOf: string, history: History): ReminderPlan {
  const before = (ref: string) => (history.get(ref) ?? []).filter(d => d < asOf).length
  const today  = (ref: string) => (history.get(ref) ?? []).includes(asOf)
  const due    = (c: Cadence, ref: string, at: string) => !today(ref) && reminderDue(c, businessDaysBetween(at, asOf), before(ref))
  const elapsed = (at: string) => businessDaysBetween(at, asOf)

  const byKey = new Map<string, TargetPlan>()
  const add = (target: ReminderTarget, ref: string, fill: (s: ReminderSections) => void) => {
    const key = targetKey(target)
    const t = byKey.get(key) ?? { target, sections: {}, refs: [] }
    fill(t.sections)
    if (!t.refs.includes(ref)) t.refs.push(ref)
    byKey.set(key, t)
  }
  const push = <T>(list: T[] | undefined, item: T): T[] => [...(list ?? []), item]

  const counts: ReminderCounts = { hireUnfinished: 0, hireFlagged: 0, tasks: 0, plans: 0, pmOpen: 0, pmClaimed: 0, payroll: 0, digest: 0, noTeam: 0 }
  const digest: Digest = { stalled: [], flagged: [], tasks: [], plans: [], pm: [], payroll: [], needsCall: [], noTeam: [], dead: snap.dead }

  // 1. Hires
  for (const h of snap.hires) {
    const target: ReminderTarget = { kind: 'hire', id: h.id }
    const hireSection = (s: ReminderSections) => (s.hire ??= { hireId: h.id, unfinished: false, flagged: [] })
    let needsCall = false
    if (h.unfinished) {
      const ref = `hu:${h.id}`
      if (due(CADENCE.hireUnfinished, ref, h.at)) { add(target, ref, s => { hireSection(s).unfinished = true }); counts.hireUnfinished++ }
      if (elapsed(h.at) >= CADENCE.hireUnfinished.first) digest.stalled.push(h.id)
      if (before(ref) >= CADENCE.hireUnfinished.max) needsCall = true
    }
    for (const f of h.flagged) {
      const ref = `hf:${h.id}:${f.form}:${f.at}`
      if (due(CADENCE.hireFlagged, ref, f.at)) { add(target, ref, s => { hireSection(s).flagged.push(f.form) }); counts.hireFlagged++ }
      if (elapsed(f.at) >= CADENCE.hireFlagged.first) digest.flagged.push({ hireId: h.id, form: f.form })
      if (before(ref) >= CADENCE.hireFlagged.max) needsCall = true
    }
    if (needsCall) digest.needsCall.push(h.id)
  }

  // 2. Stakeholder tasks: to the account the task is assigned to
  for (const t of snap.tasks) {
    const ref = `st:${t.id}`
    if (due(CADENCE.task, ref, t.at)) { add({ kind: 'stakeholder', id: t.assigneeId }, ref, s => { s.tasks = push(s.tasks, t.id) }); counts.tasks++ }
    if (elapsed(t.at) >= CADENCE.task.first) digest.tasks.push(t.id)
  }

  // 3. Manager plans: to the manager on the plan now (a reassignment starts a new count)
  for (const p of snap.plans) {
    const ref = `mp:${p.hireId}:${p.seq}`
    if (due(CADENCE.managerPlan, ref, p.at)) { add({ kind: 'manager', id: p.managerId }, ref, s => { s.plans = push(s.plans, p.hireId) }); counts.plans++ }
    if (elapsed(p.at) >= CADENCE.managerPlan.first) digest.plans.push(p.hireId)
  }

  // 4. Project management: only ever the request's own region's active team
  const noTeam = new Set<Region>()
  for (const r of snap.pm) {
    const team = snap.teams[r.region] ?? []
    if (team.length === 0) noTeam.add(r.region)
    const c = r.status === 'open' ? CADENCE.pmOpen : CADENCE.pmClaimed
    const ref = r.status === 'open' ? `po:${r.hireId}:${r.region}:${r.at}` : `pc:${r.hireId}:${r.claimedBy}:${r.at}`
    const atLimit = before(ref) >= c.max
    if (elapsed(r.at) >= c.first) digest.pm.push({ hireId: r.hireId, region: r.region, state: r.status, atLimit })
    if (!due(c, ref, r.at)) continue
    if (r.status === 'open') {
      if (team.length === 0) continue   // nobody to send to: HR digest only
      for (const memberId of team) add({ kind: 'pm_member', id: memberId, region: r.region }, ref, s => { s.pmOpen = push(s.pmOpen, { hireId: r.hireId, region: r.region }) })
      counts.pmOpen++
    } else if (r.claimedBy && team.includes(r.claimedBy)) {
      add({ kind: 'pm_member', id: r.claimedBy, region: r.region }, ref, s => { s.pmClaimed = push(s.pmClaimed, { hireId: r.hireId, region: r.region }) })
      counts.pmClaimed++
    }
  }
  digest.noTeam = REGIONS.filter(r => noTeam.has(r))
  counts.noTeam = digest.noTeam.length

  // 5. Payroll: every payroll account, daily, while hires wait
  const waiting = snap.payroll.filter(p => elapsed(p.at) >= PAYROLL_AFTER).map(p => p.hireId)
  if (waiting.length) {
    for (const id of snap.payrollAccounts) add({ kind: 'payroll', id }, `pw:${asOf}`, s => { s.payroll = [...waiting] })
    counts.payroll = waiting.length
    digest.payroll = waiting
  }

  // 6. HR digest: only when there is something to report
  const hasDigest = digest.stalled.length + digest.flagged.length + digest.tasks.length + digest.plans.length + digest.pm.length
    + digest.payroll.length + digest.needsCall.length + digest.noTeam.length + digest.dead > 0
  if (hasDigest) {
    for (const h of snap.hrMailboxes) add({ kind: 'hr', h }, `hd:${asOf}`, s => { s.digest = digest })
    counts.digest = 1
  }

  return { asOf, targets: [...byKey.values()], digest: hasDigest ? digest : null, counts }
}

// ── One email per person: targets that reach the same address are merged ──

export type PersonGroup = { person: string; hireId: string | null; to: ReminderTarget[]; sections: ReminderSections; refs: string[] }

function mergeSections(a: ReminderSections, b: ReminderSections): ReminderSections {
  const ids = (x?: string[], y?: string[]) => (x || y ? [...new Set([...(x ?? []), ...(y ?? [])])] : undefined)
  const pm = (x?: { hireId: string; region: Region }[], y?: { hireId: string; region: Region }[]) =>
    x || y ? [...(x ?? []), ...(y ?? []).filter(i => !(x ?? []).some(j => j.hireId === i.hireId && j.region === i.region))] : undefined
  const out: ReminderSections = {
    hire: a.hire ?? b.hire, tasks: ids(a.tasks, b.tasks), plans: ids(a.plans, b.plans),
    pmOpen: pm(a.pmOpen, b.pmOpen), pmClaimed: pm(a.pmClaimed, b.pmClaimed),
    payroll: ids(a.payroll, b.payroll), digest: a.digest ?? b.digest,
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as ReminderSections
}

export async function groupByPerson(
  targets: TargetPlan[],
  resolve: (t: ReminderTarget) => Promise<string[]>,
  keyOf: (email: string) => Promise<string>,
): Promise<{ groups: PersonGroup[]; unreachable: number }> {
  const groups = new Map<string, PersonGroup>()
  let unreachable = 0
  for (const t of targets) {
    const addresses = [...new Set((await resolve(t.target)).map(e => e.trim().toLowerCase()))]
    if (addresses.length !== 1) { unreachable++; continue }   // inactive, or no single address
    const person = await keyOf(addresses[0])
    const g = groups.get(person)
    if (!g) {
      groups.set(person, { person, hireId: t.target.kind === 'hire' ? t.target.id : null, to: [t.target], sections: t.sections, refs: [...t.refs] })
      continue
    }
    // Two hires sharing one address cannot share one email
    if (t.target.kind === 'hire' && g.sections.hire && g.sections.hire.hireId !== t.target.id) { unreachable++; continue }
    g.to.push(t.target)
    g.sections = mergeSections(g.sections, t.sections)
    for (const r of t.refs) if (!g.refs.includes(r)) g.refs.push(r)
    if (t.target.kind === 'hire') g.hireId = t.target.id
  }
  return { groups: [...groups.values()], unreachable }
}

// ── Loading the day's facts ──

async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw new Error(`reminder lookup failed (code ${error.code})`)
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

export type ScopeOptions = { hireIds?: string[] }

export async function loadSnapshot(admin: Admin, opts: ScopeOptions = {}): Promise<Snapshot> {
  const scope = opts.hireIds
  const inScope = <Q extends { in: (col: string, v: string[]) => Q }>(q: Q, col: string): Q => (scope ? q.in(col, scope) : q)

  // Hires still owing something (not approved, not in the payroll queue)
  const profiles = await all(async (a, b) => inScope(
    admin.from('profiles').select('id, created_at, status, entered_payroll_queue_at').eq('role', 'newhire'), 'id').range(a, b))
  const open = profiles.filter(p => !isHireDone({ status: p.status, enteredPayroll: p.entered_payroll_queue_at }))
  const openIds = open.map(p => p.id)

  const forms: Record<string, Record<string, { form_status: FormStatus; updated_at: string }>> = {}
  const docs: Record<string, { document_type: string; form_status: string; reviewed_at: string | null; updated_at: string }[]> = {}
  const equipment: Record<string, unknown> = {}
  if (openIds.length) {
    for (const [key, table] of [['personal', 'personal_info'], ['banking', 'banking_info'], ['sin', 'sin_info'], ['policy', 'policy_acknowledgements']] as const) {
      const rows = await all(async (a, b) => admin.from(table as 'policy_acknowledgements').select('user_id, form_status, updated_at').in('user_id', openIds).range(a, b))
      for (const r of rows) (forms[r.user_id] ??= {})[key] = { form_status: r.form_status, updated_at: r.updated_at }
    }
    const docRows = await all(async (a, b) => admin.from('newhire_documents').select('user_id, document_type, form_status, reviewed_at, updated_at').in('user_id', openIds).range(a, b))
    for (const d of docRows) (docs[d.user_id] ??= []).push(d)
    const eq = await all(async (a, b) => admin.from('equipment_provisioning').select('user_id, items').in('user_id', openIds).range(a, b))
    for (const e of eq) equipment[e.user_id] = e.items
  }

  const hires: Snapshot['hires'] = open.map(p => {
    const f = forms[p.id] ?? {}
    const d = docs[p.id] ?? []
    const req = { companyVehicle: hasCompanyVehicle(equipment[p.id]) }
    const formStatuses = (['personal', 'banking', 'sin', 'policy'] as const).map(k => f[k]?.form_status ?? 'pending')
    const computed = computeHireStatus(formStatuses, d, req)
    const flagged: { form: FlagSection; at: string }[] = []
    for (const k of ['personal', 'banking', 'sin', 'policy'] as const) {
      if (f[k]?.form_status === 'flagged') flagged.push({ form: k, at: torontoDate(f[k].updated_at) })
    }
    if (computed.documents.status === 'flagged') {
      const times = d.filter(x => x.form_status === 'rejected').map(x => x.reviewed_at ?? x.updated_at).sort()
      flagged.push({ form: 'documents', at: torontoDate(times[0] ?? p.created_at) })
    }
    // Same count as the "N of 5" in the email: not finished until all five are sent
    return { id: p.id, at: torontoDate(p.created_at), unfinished: sentItemCount(formStatuses, computed.documents) < TOTAL_ITEMS, flagged }
  })

  // Open stakeholder tasks
  const taskRows = await all(async (a, b) => inScope(admin.from('stakeholder_tasks').select('id, newhire_id, assigned_to, created_at, task_key')
    .eq('status', 'pending').eq('hidden_from_stakeholder', false), 'newhire_id').range(a, b))
  const tasks = taskRows.filter(t => !RETIRED_TASK_KEYS.includes(t.task_key))
    .map(t => ({ id: t.id, hireId: t.newhire_id, assigneeId: t.assigned_to, at: torontoDate(t.created_at) }))

  // Plans not submitted, anchored on the "plan needed" notice for the current manager and assignment
  const planRows = await all(async (a, b) => inScope(admin.from('manager_plans').select('newhire_id, manager_id, assignment_seq, created_at')
    .neq('status', 'submitted'), 'newhire_id').range(a, b))
  const planIds = planRows.map(p => p.newhire_id)
  // Read from the key ledger, which outlives outbox cleanup
  const planNotices = planIds.length ? await all(async (a, b) => admin.from('notification_keys').select('dedupe_key, created_at')
    .eq('template', 'manager_plan_requested').in('newhire_id', planIds).range(a, b)) : []
  const plans = planRows.map(p => {
    const key = `manager_plan_requested:${p.newhire_id}:manager:${p.manager_id}:${p.assignment_seq}`
    const notice = planNotices.find(n => n.dedupe_key === key)
    return { hireId: p.newhire_id, managerId: p.manager_id, seq: p.assignment_seq, at: torontoDate(notice?.created_at ?? p.created_at) }
  })

  // Project-management requests; an open one is anchored on its latest "created or moved" notice
  const pmRows = await all(async (a, b) => inScope(admin.from('pm_requests').select('newhire_id, region, status, claimed_by, claimed_at, created_at')
    .in('status', ['open', 'claimed']), 'newhire_id').range(a, b))
  const pmIds = pmRows.map(r => r.newhire_id)
  // Ledger keys look like pm_request_created:<hire>:pm_region:<region>:<version>
  const pmNotices = (pmIds.length ? await all(async (a, b) => admin.from('notification_keys').select('newhire_id, dedupe_key, created_at')
    .eq('template', 'pm_request_created').in('newhire_id', pmIds).range(a, b)) : [])
    .map(n => ({ newhire_id: n.newhire_id, region: n.dedupe_key.split(':')[3], created_at: n.created_at }))
  const pm = pmRows.filter(r => (REGIONS as readonly string[]).includes(r.region)).map(r => {
    if (r.status === 'claimed') {
      return { hireId: r.newhire_id, region: r.region as Region, status: 'claimed' as const, at: torontoDate(r.claimed_at ?? r.created_at), claimedBy: r.claimed_by }
    }
    const latest = pmNotices.filter(n => n.newhire_id === r.newhire_id && n.region === r.region)
      .map(n => n.created_at).sort().pop()
    return { hireId: r.newhire_id, region: r.region as Region, status: 'open' as const, at: torontoDate(latest ?? r.created_at), claimedBy: null }
  })

  const teamRows = await all(async (a, b) => admin.from('region_teams').select('id, region').eq('active', true).range(a, b))
  const teams: Snapshot['teams'] = {}
  for (const m of teamRows) if ((REGIONS as readonly string[]).includes(m.region)) (teams[m.region as Region] ??= []).push(m.id)

  // Payroll queue: entered, not marked done
  const payrollRows = await all(async (a, b) => inScope(admin.from('profiles').select('id, entered_payroll_queue_at')
    .not('entered_payroll_queue_at', 'is', null).is('payroll_completed_at', null), 'id').range(a, b))
  const payroll = payrollRows.map(p => ({ hireId: p.id, at: torontoDate(p.entered_payroll_queue_at!) }))
  const { data: payrollAccounts, error: payError } = await admin.rpc('notify_active_accounts', { p_role: 'payroll', p_ids: null })
  if (payError) throw new Error(`payroll lookup failed (code ${payError.code})`)

  let deadQuery = admin.from('notification_outbox').select('id', { count: 'exact', head: true }).eq('status', 'dead')
  if (scope) deadQuery = deadQuery.in('newhire_id', scope)
  const { count: dead } = await deadQuery

  return {
    hires, tasks, plans, pm, teams, payroll,
    payrollAccounts: (payrollAccounts ?? []).map(a => a.id),
    hrMailboxes: await Promise.all(hrNotifyEmails().map(personKey)),
    dead: dead ?? 0,
  }
}

// What earlier runs reminded about (refs of daily reminders, by the Toronto date they were for).
// Read from the key ledger, so cleaning up old outbox rows never resets a reminder count.
export async function loadHistory(admin: Admin): Promise<History> {
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString()
  const rows = await all(async (a, b) => admin.from('notification_keys').select('reminder_date, refs')
    .eq('template', 'daily_reminder').gte('created_at', since).range(a, b))
  const history: History = new Map()
  for (const r of rows) {
    if (!r.reminder_date) continue
    for (const ref of r.refs ?? []) {
      const dates = history.get(ref) ?? []
      if (!dates.includes(r.reminder_date)) dates.push(r.reminder_date)
      history.set(ref, dates)
    }
  }
  return history
}

// ── The run ──

// The cron route only works in the 9 o'clock hour in Toronto on a business day
export function reminderRunDue(now: Date): { due: boolean; date: string } {
  const date = torontoDate(now)
  return { due: torontoHour(now) === 9 && isBusinessDay(date), date }
}

export type RunOptions = ScopeOptions & {
  asOf:    string
  apply:   boolean
  // Tests only: which groups may actually be queued, and a stand-in for the team lookup
  groupFilter?: (g: PersonGroup) => boolean
  teams?:       Snapshot['teams']
}
export type RunResult =
  | { paused: true }
  | { paused: false; counts: ReminderCounts; emails: number; queued: number; duplicates: number; unreachable: number }

export async function runDailyReminders(admin: Admin, opts: RunOptions): Promise<RunResult> {
  // Paused (or the setting can't be read): nothing is queued, nothing is lost. A dry run queues
  // nothing anyway, so it still works out the counts.
  if (opts.apply && await remindersPaused(admin)) return { paused: true }

  const [snap, history] = await Promise.all([loadSnapshot(admin, opts), loadHistory(admin)])
  if (opts.teams) snap.teams = opts.teams
  const plan = planFromSnapshot(snap, opts.asOf, history)
  const { groups, unreachable } = await groupByPerson(plan.targets, t => resolveTarget(admin, t), personKey)

  let queued = 0
  let duplicates = 0
  if (opts.apply) {
    for (const g of groups) {
      if (opts.groupFilter && !opts.groupFilter(g)) continue
      const inserted = await queueNotification({
        template: 'daily_reminder', hireId: g.hireId, version: opts.asOf,
        payload:  { date: opts.asOf, person: g.person, to: g.to, sections: g.sections, refs: g.refs },
      })
      if (inserted) queued++
      else duplicates++
    }
  }
  return { paused: false, counts: plan.counts, emails: groups.length, queued, duplicates, unreachable }
}
