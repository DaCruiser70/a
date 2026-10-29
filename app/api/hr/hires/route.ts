import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { z } from 'zod'
import { computeHireStatus } from '@/lib/hire-status'
import { queueNotification, appUrl } from '@/lib/notify'
import { planChip, todayIso } from '@/lib/manager-plan'
import { getClearanceRequirements, computeClearanceStatus } from '@/lib/clearance'
import { needsPmRequest, pmChipState } from '@/lib/pm'
import { memberNames, syncPmRequest } from '@/lib/pm-server'
import { REMOTE_OFFICE, isRemoteOffice, regionForOffice } from '@/lib/branches'
import { REGIONS } from '@/lib/regions'
import type { NewHireRow } from '@/types'

function generateTempPassword(): string {
  const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lower   = 'abcdefghijklmnopqrstuvwxyz'
  const digits  = '0123456789'
  const special = '!@#$%^&*'
  const all     = upper + lower + digits + special

  const pick = (set: string) => set[randomBytes(1)[0] % set.length]
  const required = [pick(upper), pick(lower), pick(digits), pick(special)]
  const rest     = Array.from(randomBytes(8)).map(b => all[b % all.length])
  const chars    = [...required, ...rest]

  const shuffleBytes = randomBytes(chars.length)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export async function GET() {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const admin = createServiceClient()

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, full_name, aem_email, position, start_date, created_at, office_location, region')
    .eq('role', 'newhire')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const hireIds = (profiles ?? []).map(p => p.id)

  const [piRows, biRows, siRows, poRows, docRows] = hireIds.length
    ? await Promise.all([
        admin.from('personal_info').select('user_id, form_status, submitted_at').in('user_id', hireIds),
        admin.from('banking_info').select('user_id, form_status, submitted_at').in('user_id', hireIds),
        admin.from('sin_info').select('user_id, form_status, submitted_at').in('user_id', hireIds),
        admin.from('policy_acknowledgements').select('user_id, form_status, submitted_at').in('user_id', hireIds),
        admin.from('newhire_documents').select('user_id, document_type, form_status').in('user_id', hireIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }, { data: [] }]
  const docsByUser: Record<string, { document_type: string; form_status: string }[]> = {}
  for (const d of docRows.data ?? []) (docsByUser[d.user_id] ??= []).push(d)

  // Batched queries for every listed hire's manager plan, clearance form and project-management
  // request (no per-row lookups)
  const [{ data: planRows }, { data: clearanceRows }, { data: pmRows }] = hireIds.length
    ? await Promise.all([
        admin.from('manager_plans').select('newhire_id, status, due_date, clearance_type').in('newhire_id', hireIds),
        admin.from('clearance_info').select('user_id, form_status').in('user_id', hireIds),
        admin.from('pm_requests').select('newhire_id, status, claimed_by').in('newhire_id', hireIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]
  const planMap      = Object.fromEntries((planRows ?? []).map(r => [r.newhire_id, r]))
  const clearanceMap = Object.fromEntries((clearanceRows ?? []).map(r => [r.user_id, r]))
  const pmMap        = Object.fromEntries((pmRows ?? []).map(r => [r.newhire_id, r]))
  const claimerNames = await memberNames(admin, (pmRows ?? []).filter(r => r.status === 'claimed').map(r => r.claimed_by))
  const today   = todayIso()

  const piMap = Object.fromEntries((piRows.data ?? []).map(r => [r.user_id, r]))
  const biMap = Object.fromEntries((biRows.data ?? []).map(r => [r.user_id, r]))
  const siMap = Object.fromEntries((siRows.data ?? []).map(r => [r.user_id, r]))
  const poMap = Object.fromEntries((poRows.data ?? []).map(r => [r.user_id, r]))

  const hires: NewHireRow[] = (profiles ?? []).map(p => {
    const submittedDate = p.start_date ?? p.created_at.slice(0, 10)
    const days = Math.floor((Date.now() - new Date(submittedDate).getTime()) / 86_400_000)
    const computed = computeHireStatus([
      piMap[p.id]?.form_status, biMap[p.id]?.form_status,
      siMap[p.id]?.form_status, poMap[p.id]?.form_status,
    ], docsByUser[p.id] ?? [])
    const timestamps = [
      piMap[p.id]?.submitted_at, biMap[p.id]?.submitted_at,
      siMap[p.id]?.submitted_at, poMap[p.id]?.submitted_at,
    ].filter((t): t is string => !!t)
    const last_submitted_at = timestamps.length > 0
      ? timestamps.reduce((a, b) => (a > b ? a : b))
      : null
    return {
      id:                p.id,
      name:              p.full_name,
      email:             p.aem_email,
      role:              p.position ?? '—',
      status:            computed.status,
      progress:          computed.progressPct,
      approved_items:    computed.approvedCount,
      total_items:       computed.totalItems,
      submitted:         submittedDate,
      days:              Math.max(0, days),
      last_submitted_at,
      office_location:   p.office_location ?? null,
      plan_chip:         planChip(planMap[p.id], today),
      // Shown only when the manager's submitted plan asks for a clearance; never affects status or progress
      clearance_chip:    getClearanceRequirements(planMap[p.id]).required
        ? computeClearanceStatus(clearanceMap[p.id]?.form_status)
        : null,
      pm_chip:           (() => {
        const state = pmChipState(needsPmRequest(planMap[p.id]), pmMap[p.id], p.region)
        if (!state) return null
        const claimer = state === 'claimed' ? pmMap[p.id]?.claimed_by : null
        return { state, claimed_by_name: claimer ? claimerNames[claimer] ?? null : null }
      })(),
    }
  })

  return NextResponse.json({ hires })
}

// app_metadata must hold role 'newhire' and roles ['newhire'] (parseRoles in lib/portals.ts)
async function ensureNewhireAppMetadata(admin: ReturnType<typeof createServiceClient>, userId: string): Promise<boolean> {
  const has = (meta: Record<string, unknown> | undefined) =>
    meta?.role === 'newhire' && Array.isArray(meta?.roles) && (meta.roles as unknown[]).includes('newhire')
  const { data: first } = await admin.auth.admin.getUserById(userId)
  if (has(first.user?.app_metadata)) return true
  const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { role: 'newhire', roles: ['newhire'] } })
  if (error) return false
  const { data: again } = await admin.auth.admin.getUserById(userId)
  return has(again.user?.app_metadata)
}

const OFFICE_LOCATIONS = ['Dartmouth NS', 'Moncton NB', 'Oakville ON', REMOTE_OFFICE] as const
const PROBATION_PERIODS = ['3 Months', '6 Months', 'Waived'] as const
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)))

const CreateHireSchema = z.strictObject({
  name:               z.string().trim().min(1).max(150),
  preferredName:      z.string().trim().max(150).optional().default(''),
  personalEmail:      z.string().trim().toLowerCase().max(254).pipe(z.email()),
  aemEmail:           z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role:               z.string().trim().min(1).max(150),
  officeLocation:     z.enum(OFFICE_LOCATIONS),
  // Only read for Remote; every other office's region comes from lib/branches.ts
  region:             z.enum(REGIONS).optional(),
  reportingManagerId: z.uuid(),
  startDate:          isoDate,
  formDeadline:       isoDate,
  probationPeriod:    z.enum(PROBATION_PERIODS),
}).refine(v => v.formDeadline <= v.startDate, { path: ['formDeadline'] })
  .refine(v => !isRemoteOffice(v.officeLocation) || !!v.region, { path: ['region'] })

export async function POST(request: Request) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:create-hire', user.id), 30, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many new hires created in a short time. Please wait a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = CreateHireSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Please check the form — some fields are missing or invalid.' }, { status: 400 })
  }
  const {
    name, preferredName, personalEmail, aemEmail,
    role: position, officeLocation, region: chosenRegion, reportingManagerId,
    startDate, formDeadline, probationPeriod,
  } = parsed.data

  // Any region the browser sends for a non-Remote office is ignored
  const region = isRemoteOffice(officeLocation) ? chosenRegion ?? null : regionForOffice(officeLocation)
  if (!region) {
    return NextResponse.json({ error: 'Please choose a region for this remote hire.' }, { status: 400 })
  }

  const admin = createServiceClient()

  // Name and email are copied from the directory; the client never supplies them
  const { data: manager } = await admin
    .from('managers')
    .select('id, full_name, email')
    .eq('id', reportingManagerId)
    .eq('active', true)
    .maybeSingle()
  if (!manager) {
    return NextResponse.json({ error: 'Please choose a reporting manager from the list.' }, { status: 400 })
  }

  // Calculate probation end date from start date
  let probationEndDate: string | null = null
  if (probationPeriod !== 'Waived') {
    const start = new Date(startDate)
    start.setDate(start.getDate() + (probationPeriod === '3 Months' ? 90 : 180))
    probationEndDate = start.toISOString().slice(0, 10)
  }
  const probationStatus = probationPeriod === 'Waived' ? 'waived' : 'in-progress'

  const tempPassword = generateTempPassword()

  // The role is set only in app_metadata, which users cannot change
  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email:         aemEmail,
    password:      tempPassword,
    email_confirm: true,
    // Both keys: the middleware and requireRole read app_metadata.roles, not role
    app_metadata:  { role: 'newhire', roles: ['newhire'] },
    user_metadata: { full_name: name },
  })

  if (createError || !newUser.user) {
    console.error(`[hires] createUser failed (status ${createError?.status ?? 'unknown'})`)
    return NextResponse.json(
      { error: 'Could not create the account. The AEM email may already be in use.' },
      { status: 409 },
    )
  }

  const { error: updateError } = await admin
    .from('profiles')
    .update({
      // Set explicitly: the signup trigger can run before GoTrue applies app_metadata, and GoTrue's
      // own write can replace what the roles trigger mirrored. Naming role/roles here fires
      // sync_roles_to_auth again, after the user exists.
      role:                    'newhire',
      roles:                   ['newhire'],
      position,
      start_date:              startDate,
      preferred_name:          preferredName || null,
      personal_email:          personalEmail,
      office_location:         officeLocation,
      region,
      reporting_manager_id:    manager.id,
      reporting_manager_name:  manager.full_name,
      reporting_manager_email: manager.email,
      form_deadline:           formDeadline,
      probation_period:        probationPeriod,
      probation_end_date:      probationEndDate,
      probation_status:        probationStatus,
      updated_at:              new Date().toISOString(),
    })
    .eq('id', newUser.user.id)

  if (updateError) {
    console.error(`[hires] profile update failed (code ${updateError.code})`)
    // Clean up orphaned auth user if profile update fails
    await admin.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: 'Failed to set up profile. Please try again.' }, { status: 500 })
  }

  // The new hire can only enter the portal if the session's app_metadata carries the role list.
  // Check it, set it directly if it is missing, and refuse to finish if it still is not there.
  if (!(await ensureNewhireAppMetadata(admin, newUser.user.id))) {
    console.error('[hires] app_metadata roles could not be set')
    await admin.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: 'Failed to set up the account. Please try again.' }, { status: 500 })
  }

  // Ask the reporting manager for an onboarding plan, due on the hire's form deadline
  const { data: plan, error: planError } = await admin.from('manager_plans').insert({
    newhire_id: newUser.user.id,
    manager_id: manager.id,
    status:     'requested',
    due_date:   formDeadline,
  }).select('assignment_seq').single()

  if (planError || !plan) {
    console.error(`[hires] manager plan insert failed (code ${planError?.code ?? 'none'})`)
    // Same orphan cleanup as above: the profile row goes with the auth user
    await admin.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: 'Failed to set up the manager plan. Please try again.' }, { status: 500 })
  }

  await admin.from('audit_log').insert({
    user_id:      newUser.user.id,
    action_type:  'navy',
    message:      '<strong>HR</strong> created the onboarding account',
    performed_by: user.id,
  })

  await queueNotification({
    template:  'manager_plan_requested',
    to:        manager.email,
    dedupeKey: `manager_plan_request:${newUser.user.id}:${manager.id}:${plan.assignment_seq}`,
    payload:   {
      newhireId: newUser.user.id,
      managerId: manager.id,
      hireName:  name,
      link:      appUrl(`/manager/newhire/${newUser.user.id}`),
    },
  })

  // No-op until the manager submits a PSPC & RCMP plan; kept so every region save runs the sync
  await syncPmRequest(admin, newUser.user.id)

  return NextResponse.json({ ok: true, id: newUser.user.id, tempPassword })
}
