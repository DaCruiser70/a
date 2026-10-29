import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { computeHireStatus, type DocumentsItem } from '@/lib/hire-status'
import { todayIso } from '@/lib/manager-plan'
import {
  DASH_FILTERS, DASH_PAGE_SIZE, STATUS_ORDER, matchesFilter,
  type DashActivity, type DashFilter, type DashResponse, type DashRow,
} from '@/lib/hr-dashboard'
import type { FormStatus } from '@/types'

const QuerySchema = z.strictObject({
  filter: z.enum(DASH_FILTERS).default('all'),
  q:      z.string().trim().max(100).default(''),
  page:   z.coerce.number().int().min(1).max(1000).default(1),
})

const FORM_IDS = ['personal', 'banking', 'sin', 'policy'] as const
type FormId = typeof FORM_IDS[number]
const FORM_SHORT: Record<FormId, string> = {
  personal: 'Personal Information',
  banking:  'Banking',
  sin:      'Social Insurance Number',
  policy:   'Policy Acknowledgement',
}

// One plain line saying what happens next, from the four forms and the Documents item
function nextStep(status: DashRow['status'], forms: Record<FormId, FormStatus>, docs: DocumentsItem, payrollDone: boolean): string {
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  switch (status) {
    case 'flagged': {
      const items = [...FORM_IDS.filter(f => forms[f] === 'flagged').map(f => FORM_SHORT[f]), ...docs.flagged]
      return items.length <= 2 ? `Waiting on hire to fix ${items.join(' and ')}` : `Waiting on hire to fix ${items.length} items`
    }
    case 'needs-review': {
      const formsInReview = FORM_IDS.filter(f => forms[f] === 'review')
      const docsInReview  = docs.slots.some(s => s.state === 'review')
      const n = formsInReview.length + (docsInReview ? 1 : 0)
      if (n === 1) return formsInReview.length ? `Review ${FORM_SHORT[formsInReview[0]]}` : 'Review documents'
      return `Review ${n} items`
    }
    case 'in-progress': {
      const formsLeft = FORM_IDS.filter(f => forms[f] === 'pending').length
      const docsLeft  = docs.missing.length
      if (formsLeft && docsLeft) return `Waiting on hire: ${plural(formsLeft, 'form')} and ${plural(docsLeft, 'document')}`
      if (docsLeft === 1)        return `Waiting on hire: ${docs.missing[0]}`
      if (docsLeft > 1)          return `Waiting on hire: ${plural(docsLeft, 'document')}`
      return `Waiting on hire: ${plural(formsLeft, 'form')} left`
    }
    case 'not-started':  return 'Waiting on hire to start'
    case 'approved':     return payrollDone ? 'Payroll complete' : 'Ready for payroll'
  }
}

// ── Recent activity: an allow-list of safe events, rewritten as short sentences from fixed text and
// the hire's name. Anything that does not match (reveals, codes, record opened, views, downloads,
// notes, reasons, values) is never shown.
const FORM_FROM_ID: Record<string, string> = { personal: 'Personal Information', banking: 'Banking', sin: 'Social Insurance Number', policy: 'Policy Acknowledgement' }
const ACTIVITY_RULES: { re: RegExp; build: (hire: string, m: RegExpMatchArray) => string; tone: DashActivity['tone'] }[] = [
  { re: /submitted personal information$/,                 build: h => `${h} submitted Personal Information`,      tone: 'navy' },
  { re: /submitted banking &amp; direct deposit$/,         build: h => `${h} submitted Banking & Direct Deposit`,  tone: 'navy' },
  { re: /submitted Social Insurance Number$/,              build: h => `${h} submitted Social Insurance Number`,   tone: 'navy' },
  { re: /submitted all 4 forms/,                           build: h => `${h} submitted Policy Acknowledgement`,    tone: 'navy' },
  { re: /has sent every required form to HR$/,             build: h => `${h} sent every required form to HR`,      tone: 'navy' },
  { re: /marked (personal|banking|sin|policy) form as <strong>flagged<\/strong>/, build: (h, m) => `${h} was flagged on ${FORM_FROM_ID[m[1]]}`, tone: 'red' },
  { re: /marked (personal|banking|sin|policy) form as <strong>approved<\/strong>/, build: (h, m) => `${h}’s ${FORM_FROM_ID[m[1]]} was approved`, tone: 'green' },
  { re: /submitted the security clearance form$/,          build: h => `${h} submitted the security clearance form`, tone: 'navy' },
  { re: /marked clearance form as <strong>flagged<\/strong>/,  build: h => `${h} was flagged on the security clearance form`, tone: 'red' },
  { re: /marked clearance form as <strong>approved<\/strong>/, build: h => `${h}’s security clearance form was approved`,  tone: 'green' },
  { re: /^<strong>Manager<\/strong> submitted the plan$/,  build: h => `Manager plan submitted for ${h}`,          tone: 'violet' },
  { re: /\(project management\) marked the project management request as done$/, build: h => `Project request finished for ${h}`, tone: 'copper' },
]

// HR dashboard data: one page of hires (filtered, searched and sorted here, never in the browser),
// chip counts, the four tiles, "Starting soon" and "Recent activity". Statuses come from
// computeHireStatus on all five items (four forms + Documents), exactly as GET /api/hr/hires does.
export async function GET(request: Request) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const limit = await rateLimit(await rateLimitKey('hr:dashboard', auth.user.id), 240, 5 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { filter, q, page } = parsed.data

  const admin = createServiceClient()
  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, full_name, aem_email, position, start_date, office_location, payroll_completed_at')
    .eq('role', 'newhire')
  if (error) {
    console.error(`[hr/dashboard] profiles failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not load the dashboard. Please try again.' }, { status: 500 })
  }

  const ids = (profiles ?? []).map(p => p.id)
  const [pi, bi, si, po, dc] = ids.length
    ? await Promise.all([
        admin.from('personal_info').select('user_id, form_status').in('user_id', ids),
        admin.from('banking_info').select('user_id, form_status').in('user_id', ids),
        admin.from('sin_info').select('user_id, form_status').in('user_id', ids),
        admin.from('policy_acknowledgements').select('user_id, form_status').in('user_id', ids),
        admin.from('newhire_documents').select('user_id, document_type, form_status').in('user_id', ids),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }]
  const docsByUser: Record<string, { document_type: string; form_status: string }[]> = {}
  for (const d of dc.data ?? []) (docsByUser[d.user_id] ??= []).push(d)
  const byUser = (rows: { user_id: string; form_status: FormStatus }[] | null) =>
    Object.fromEntries((rows ?? []).map(r => [r.user_id, r.form_status])) as Record<string, FormStatus>
  const maps = { personal: byUser(pi.data), banking: byUser(bi.data), sin: byUser(si.data), policy: byUser(po.data) }

  const rows: DashRow[] = (profiles ?? []).map(p => {
    const forms = Object.fromEntries(FORM_IDS.map(f => [f, maps[f][p.id] ?? 'pending'])) as Record<FormId, FormStatus>
    const computed = computeHireStatus(FORM_IDS.map(f => forms[f]), docsByUser[p.id] ?? [])
    return {
      id:              p.id,
      name:            p.full_name,
      email:           p.aem_email,
      role:            p.position ?? '—',
      office_location: p.office_location ?? null,
      start_date:      p.start_date ?? null,
      status:          computed.status,
      approved:        computed.approvedCount,
      next_step:       nextStep(computed.status, forms, computed.documents, !!p.payroll_completed_at),
    }
  })

  // ── Tiles (all hires, no filter or search), as the dashboard counted them before ──
  const thisMonth = todayIso().slice(0, 7)   // YYYY-MM, Toronto time
  const stats = {
    startingThisMonth: rows.filter(r => r.start_date?.startsWith(thisMonth)).length,
    active:      rows.length,
    needsReview: rows.filter(r => r.status === 'needs-review').length,
    flagged:     rows.filter(r => r.status === 'flagged').length,
    approved:    rows.filter(r => r.status === 'approved').length,
  }

  // ── Search, chip counts, filter, sort, page ──
  const needle   = q.toLowerCase()
  const searched = needle ? rows.filter(r => r.name.toLowerCase().includes(needle) || r.email.toLowerCase().includes(needle)) : rows
  const counts   = Object.fromEntries(DASH_FILTERS.map(f => [f, searched.filter(r => matchesFilter(r.status, f)).length])) as Record<DashFilter, number>
  const filtered = searched
    .filter(r => matchesFilter(r.status, filter))
    .sort((a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      || (a.start_date ?? '9999-12-31').localeCompare(b.start_date ?? '9999-12-31')
      || a.name.localeCompare(b.name))
  const pages    = Math.max(1, Math.ceil(filtered.length / DASH_PAGE_SIZE))
  const current  = Math.min(page, pages)
  const hires    = filtered.slice((current - 1) * DASH_PAGE_SIZE, current * DASH_PAGE_SIZE)

  // ── Starting soon: the next 3 start dates in the next 30 days ──
  const today = todayIso()
  const in30  = new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  const startingSoon = rows
    .filter(r => r.start_date && r.start_date >= today && r.start_date <= in30)
    .sort((a, b) => a.start_date!.localeCompare(b.start_date!))
    .slice(0, 3)
    .map(r => ({ id: r.id, name: r.name, role: r.role, start_date: r.start_date! }))

  // ── Recent activity: newest allowed events for new hires ──
  const nameById = Object.fromEntries(rows.map(r => [r.id, r.name]))
  const activity: DashActivity[] = []
  if (ids.length) {
    const { data: events } = await admin
      .from('audit_log')
      .select('id, user_id, message, created_at')
      .in('user_id', ids)
      .order('created_at', { ascending: false })
      .limit(80)
    for (const e of events ?? []) {
      const hire = nameById[e.user_id]
      if (!hire) continue
      const rule = ACTIVITY_RULES.find(r => r.re.test(e.message))
      if (!rule) continue
      const m = e.message.match(rule.re)!
      activity.push({ id: e.id, text: rule.build(hire, m), at: e.created_at, tone: rule.tone })
      if (activity.length === 5) break
    }
  }

  const body: DashResponse = { hires, total: filtered.length, page: current, pages, counts, stats, startingSoon, activity }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
