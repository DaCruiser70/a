import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'
import type { ReminderBlock, ReminderView } from '@/lib/email-templates'
import { TOTAL_ITEMS, computeHireStatus, loadHireStatusInputs, type DocumentsItem } from '@/lib/hire-status'
import { readableDate } from '@/lib/password-setup'
import { FLAG_SECTIONS, FLAG_SECTION_LABELS, LINK_ROUTES, type FlagSection } from '@/lib/notification-templates'
import type { DailyReminderPayload } from '@/lib/reminder-payload'

// Server only. Turns a queued daily reminder (ids only) into what the email shows, at send time.
// Every item is checked again: anything finished, reassigned or moved to another region since it was
// queued is dropped, and an item is only shown to the target it belongs to. Names, form titles,
// counts and dates only: never notes, SIN, banking, ID details or form contents.
// Returns null when nothing is left to remind about.

type Admin = SupabaseClient<Database>


async function names(admin: Admin, ids: string[]): Promise<Map<string, { name: string; start: string | null }>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const { data } = await admin.from('profiles').select('id, full_name, start_date').in('id', unique)
  return new Map((data ?? []).map(p => [p.id, { name: p.full_name?.trim() || 'A new hire', start: p.start_date }]))
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// "N of 5" in the hire's reminder: what the hire has completed and sent, never what HR has approved.
// A form counts once the hire has sent it (in review, approved or flagged: it was sent; a flagged
// one is also named as needing a fix). Documents count once every required slot has an upload.
// Reminder-only: the status logic (computeHireStatus) is called, never changed.
export function sentItemCount(forms: (string | null | undefined)[], documents: DocumentsItem): number {
  const formsSent = forms.filter(s => (s ?? 'pending') !== 'pending').length
  const docsComplete = documents.slots.length > 0 && documents.slots.every(s => s.state !== 'missing')
  return formsSent + (docsComplete ? 1 : 0)
}

// Hire still not finished (not everything sent yet) or flagged items not fixed
export async function hireReminderState(admin: Admin, hireId: string) {
  const [{ data: profile }, inputs] = await Promise.all([
    admin.from('profiles').select('full_name, preferred_name, status, entered_payroll_queue_at').eq('id', hireId).maybeSingle(),
    loadHireStatusInputs(admin, hireId),
  ])
  const computed = computeHireStatus(inputs.forms, inputs.docs, inputs.req)
  // By key, never by position: inputs.forms is personal, banking, sin, policy (loadHireStatusInputs)
  const [personal, banking, sin, policy] = inputs.forms.map(s => s ?? 'pending')
  const byItem: Record<FlagSection, string> = { personal, banking, sin, policy, documents: computed.documents.status }
  const done     = isHireDone({ status: profile?.status ?? null, enteredPayroll: profile?.entered_payroll_queue_at ?? null })
  const sent     = sentItemCount(inputs.forms, computed.documents)
  return {
    profile,
    sentCount:  sent,
    totalItems: TOTAL_ITEMS,
    unfinished: !done && sent < TOTAL_ITEMS,
    flagged:    done ? [] : FLAG_SECTIONS.filter(f => byItem[f] === 'flagged'),
  }
}

// A hire who is approved (or already in the payroll queue) gets no more hire reminders. There is
// no archived or withdrawn state for hires in this app.
export function isHireDone(h: { status: string | null; enteredPayroll: string | null }): boolean {
  return h.status === 'approved' || !!h.enteredPayroll
}

export async function loadReminderView(admin: Admin, p: DailyReminderPayload, base: string): Promise<ReminderView | null> {
  const link = (route: keyof typeof LINK_ROUTES) => `${base}${(LINK_ROUTES[route] as () => string)()}`
  const of = <K extends DailyReminderPayload['to'][number]['kind']>(kind: K) =>
    p.to.filter((t): t is Extract<DailyReminderPayload['to'][number], { kind: K }> => t.kind === kind)

  const blocks: ReminderBlock[] = []
  let greeting: string | null = null
  const s = p.sections

  // ── The hire's own reminder ──
  if (s.hire && of('hire').some(t => t.id === s.hire!.hireId)) {
    const state = await hireReminderState(admin, s.hire.hireId)
    const lines: string[] = []
    if (s.hire.unfinished && state.unfinished) {
      lines.push(`You have completed and sent ${state.sentCount} of ${state.totalItems} onboarding steps. A few are still waiting for you.`)
    }
    const flagged = s.hire.flagged.filter(f => state.flagged.includes(f))
    if (flagged.length) {
      lines.push(`${flagged.length === 1 ? 'This section needs' : 'These sections need'} a fix: ${flagged.map(f => FLAG_SECTION_LABELS[f]).join(', ')}. See the portal for details.`)
    }
    if (lines.length) {
      const first = state.profile?.preferred_name?.trim() || state.profile?.full_name?.trim().split(/\s+/)[0] || ''
      greeting = first ? `Hi ${first},` : 'Hello,'
      blocks.push({ heading: 'Your onboarding', lines, items: [], button: 'Open my forms', link: link('newhire_forms') })
    }
  }

  // ── Stakeholder tasks assigned to this person, still open ──
  const stakeholderIds = of('stakeholder').map(t => t.id)
  if (s.tasks?.length && stakeholderIds.length) {
    const { data: tasks } = await admin.from('stakeholder_tasks').select('id, newhire_id, task_name')
      .in('id', s.tasks).in('assigned_to', stakeholderIds).eq('status', 'pending').eq('hidden_from_stakeholder', false)
    const hires = await names(admin, (tasks ?? []).map(t => t.newhire_id))
    if (tasks?.length) {
      blocks.push({
        heading: 'Your open onboarding tasks',
        lines: [`${plural(tasks.length, 'task')} still open.`],
        items: tasks.map(t => `${t.task_name} for ${hires.get(t.newhire_id)?.name ?? 'a new hire'}`),
        button: 'Open my tasks', link: link('stakeholder_home'),
      })
    }
  }

  // ── Plans this manager still owes (only while the plan is still theirs) ──
  const managerIds = of('manager').map(t => t.id)
  if (s.plans?.length && managerIds.length) {
    const { data: plans } = await admin.from('manager_plans').select('newhire_id')
      .in('newhire_id', s.plans).in('manager_id', managerIds).neq('status', 'submitted')
    const hires = await names(admin, (plans ?? []).map(x => x.newhire_id))
    if (plans?.length) {
      blocks.push({
        heading: 'Onboarding plans waiting for you',
        lines: [`${plural(plans.length, 'plan')} not submitted yet.`],
        items: plans.map(x => {
          const h = hires.get(x.newhire_id)
          return `${h?.name ?? 'A new hire'}${h?.start ? `, starting ${readableDate(h.start)}` : ''}`
        }),
        button: 'Open my plans', link: link('manager_home'),
      })
    }
  }

  // ── Project management: only requests still in this member's own region ──
  const pmTargets = of('pm_member')
  for (const kind of ['open', 'claimed'] as const) {
    const items = (kind === 'open' ? s.pmOpen : s.pmClaimed) ?? []
    const regions = new Set(pmTargets.map(t => t.region))
    const wanted = items.filter(i => regions.has(i.region))
    if (!wanted.length) continue
    const { data: reqs } = await admin.from('pm_requests').select('newhire_id, region, claimed_by')
      .in('newhire_id', wanted.map(i => i.hireId)).eq('status', kind)
    const ok = (reqs ?? []).filter(r => wanted.some(i => i.hireId === r.newhire_id && i.region === r.region)
      && (kind === 'open' || pmTargets.some(t => t.id === r.claimed_by && t.region === r.region)))
    if (!ok.length) continue
    const hires = await names(admin, ok.map(r => r.newhire_id))
    blocks.push(kind === 'open'
      ? { heading: 'Project requests waiting to be claimed', lines: [`${plural(ok.length, 'request')} in your region nobody has claimed yet.`],
          items: ok.map(r => `${hires.get(r.newhire_id)?.name ?? 'A new hire'} (${r.region})`), button: 'Open project requests', link: link('pm_home') }
      : { heading: 'Project requests you claimed', lines: [`${plural(ok.length, 'request')} you claimed ${ok.length === 1 ? 'is' : 'are'} not marked done yet.`],
          items: ok.map(r => `${hires.get(r.newhire_id)?.name ?? 'A new hire'} (${r.region})`), button: 'Open my requests', link: link('pm_home') })
  }

  // ── Payroll: hires still waiting ──
  if (s.payroll?.length && of('payroll').length) {
    const { data: waiting } = await admin.from('profiles').select('id, full_name')
      .in('id', s.payroll).not('entered_payroll_queue_at', 'is', null).is('payroll_completed_at', null)
    if (waiting?.length) {
      blocks.push({
        heading: 'Hires waiting for payroll', lines: [`${plural(waiting.length, 'hire')} waiting to be marked done.`],
        items: waiting.map(w => w.full_name?.trim() || 'A new hire'), button: 'Open the payroll queue', link: link('payroll_queue'),
      })
    }
  }

  // ── HR digest: a snapshot from the morning run; counts first, then names ──
  const d = s.digest
  if (d && of('hr').length) {
    const all = await names(admin, [...d.stalled, ...d.flagged.map(f => f.hireId), ...d.plans, ...d.pm.map(x => x.hireId), ...d.payroll, ...d.needsCall])
    const n = (id: string) => all.get(id)?.name ?? 'A new hire'
    const { data: tasks } = d.tasks.length
      ? await admin.from('stakeholder_tasks').select('id, newhire_id, task_name').in('id', d.tasks)
      : { data: [] as { id: string; newhire_id: string; task_name: string }[] }
    const taskHires = await names(admin, (tasks ?? []).map(t => t.newhire_id))
    const atLimit = d.pm.filter(x => x.atLimit)

    const sections: [string, string[]][] = [
      ['Stalled hires', d.stalled.map(n)],
      ['Flagged forms not fixed', d.flagged.map(f => `${n(f.hireId)}: ${FLAG_SECTION_LABELS[f.form]}`)],
      ['Stakeholder tasks overdue', (tasks ?? []).map(t => `${t.task_name} for ${taskHires.get(t.newhire_id)?.name ?? 'a new hire'}`)],
      ['Manager plans overdue', d.plans.map(n)],
      ['Project management requests overdue', d.pm.map(x => `${n(x.hireId)} (${x.region}, ${x.state === 'open' ? 'not claimed' : 'claimed, not done'})`)],
      ['Project management requests at their reminder limit', atLimit.map(x => `${n(x.hireId)} (${x.region})`)],
      ['Payroll waiting', d.payroll.map(n)],
      ['Hires at their reminder limit: needs a call', d.needsCall.map(n)],
      ['Regions with no active team', d.noTeam.map(r => `No active team for ${r}`)],
    ]
    const counts = sections.filter(([, items]) => items.length).map(([title, items]) => `${title}: ${items.length}`)
    if (d.dead > 0) counts.push(`Dead notifications in the outbox: ${d.dead}`)
    if (counts.length) {
      blocks.push({ heading: 'HR daily summary', lines: ['Today at a glance:'], items: counts, button: 'Open the HR dashboard', link: link('hr_home') })
      for (const [title, items] of sections) {
        if (items.length) blocks.push({ heading: title, lines: [], items, button: 'Open the HR dashboard', link: link('hr_home') })
      }
      if (d.dead > 0) {
        blocks.push({ heading: 'Dead notifications', lines: [`${plural(d.dead, 'notification')} could not be delivered after five attempts.`], items: [],
          button: 'Open queued notifications', link: link('hr_outbox') })
      }
    }
  }

  if (blocks.length === 0) return null
  const onlyDigest = blocks.every(b => b.link === link('hr_home') || b.link === link('hr_outbox'))
  const subject = onlyDigest ? 'HR daily summary'
    : blocks.length === 1 && blocks[0].heading === 'Your onboarding' ? 'Reminder: your onboarding'
    : 'Your onboarding reminders for today'
  return { subject, greeting, blocks }
}

export { FLAG_SECTIONS }
