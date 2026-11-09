import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, RegionName, RegionTeamMember } from '@/types'
import { isRegion, needsPmRequest, type PmProjectBlock, type PmTab } from '@/lib/pm'
import { esc } from '@/lib/safe-html'
import { queueNotification } from '@/lib/notify'

// Server-only helpers for regional project management.

type Admin = SupabaseClient<Database>

export type PmMember = Pick<RegionTeamMember, 'id' | 'region' | 'member_name' | 'member_email'>

// For routes that allow only project_mgmt: requireRole has already required a member;
// this narrows the type and fails closed if it is ever missing.
export function pmMemberOr401(member: PmMember | null): PmMember | null {
  return member && isRegion(member.region) ? member : null
}

// The region a shared project-management account serves (profiles.region)
export async function accountRegion(admin: Admin, userId: string): Promise<RegionName | null> {
  const { data } = await admin.from('profiles').select('region').eq('id', userId).maybeSingle()
  return isRegion(data?.region) ? data.region : null
}

// Active team members for a region, sorted by name
export async function activeRegionMembers(admin: Admin, region: RegionName): Promise<PmMember[]> {
  const { data, error } = await admin
    .from('region_teams')
    .select('id, region, member_name, member_email')
    .eq('region', region)
    .eq('active', true)
    .order('member_name', { ascending: true })
  if (error) {
    console.error(`[pm] region team lookup failed (code ${error.code})`)
    return []
  }
  return data ?? []
}

// The team member a session belongs to, only if still active and in the account's own region.
// Anything else — unknown id, inactive, another region, no region — is null.
export async function loadAccountMember(admin: Admin, userId: string, memberId: string | null | undefined): Promise<PmMember | null> {
  if (!memberId) return null
  const region = await accountRegion(admin, userId)
  if (!region) return null
  const { data } = await admin
    .from('region_teams')
    .select('id, region, member_name, member_email')
    .eq('id', memberId)
    .eq('region', region)
    .eq('active', true)
    .maybeSingle()
  return data ?? null
}

// Names for a set of team-member ids (claimed_by / completed_by)
export async function memberNames(admin: Admin, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((v): v is string => !!v))]
  if (unique.length === 0) return {}
  const { data } = await admin.from('region_teams').select('id, member_name').in('id', unique)
  return Object.fromEntries((data ?? []).map(m => [m.id, m.member_name]))
}

export type PmSyncResult = 'not_needed' | 'needs_region' | 'open' | 'claimed' | 'done' | 'cancelled'

// Who or what caused a sync, for the audit entry. label is a fixed word, never a person's name.
export type PmActor = { by: string | null; label: 'Manager' | 'HR' | 'Project management' | 'One-time fix' }

async function auditPm(admin: Admin, hireId: string, actor: PmActor, message: string) {
  const { error } = await admin.from('audit_log').insert({
    user_id: hireId, action_type: 'navy', performed_by: actor.by,
    message: `${message} (project region on the manager plan; triggered by <strong>${esc(actor.label)}</strong>)`,
  })
  if (error) console.error(`[pm] audit insert failed (code ${error.code})`)
}

// Keeps the hire's pm_requests row in step with the manager plan. Idempotent; safe to call after
// every plan save, reassignment or release. The plan's project region alone decides the team; the
// hire's own region is never read.
//   PSPC & RCMP submitted, valid project region → request exists (created, or reopened if cancelled)
//   PSPC & RCMP submitted, no project region    → no request; HR sees "No project region"
//   project region changed, request open        → moved to the new region's team
//   project region changed, request claimed     → stays; HR is warned (pmRegionWarnings). Once the
//                                                 claim is released, the next sync moves it
//   project region changed, request done        → never changes
//   not PSPC & RCMP any more                    → an open or claimed request is cancelled (done is kept)
// The team's notice uses the time of the change as its dedupe version: a conditional UPDATE means
// only one caller gets here per change, and a later move back to a region is not swallowed.
export async function syncPmRequest(admin: Admin, hireId: string, actor: PmActor): Promise<PmSyncResult> {
  const [{ data: plan }, { data: existing }] = await Promise.all([
    admin.from('manager_plans').select('status, clearance_type, project_region').eq('newhire_id', hireId).maybeSingle(),
    admin.from('pm_requests').select('id, status, region').eq('newhire_id', hireId).maybeSingle(),
  ])
  const now = new Date().toISOString()

  if (!needsPmRequest(plan)) {
    if (existing && (existing.status === 'open' || existing.status === 'claimed')) {
      await admin.from('pm_requests')
        .update({ status: 'cancelled', updated_at: now })
        .eq('newhire_id', hireId)
        .in('status', ['open', 'claimed'])
    }
    return existing?.status === 'done' ? 'done' : existing ? 'cancelled' : 'not_needed'
  }

  // No guess and no fallback: without a valid project region nothing is created or moved
  const region = isRegion(plan?.project_region) ? plan.project_region : null
  if (!region) return existing && existing.status !== 'cancelled' ? existing.status : 'needs_region'

  let becameOpen = false
  if (!existing) {
    // A concurrent call loses the insert race and is ignored
    const { data: inserted } = await admin.from('pm_requests')
      .upsert({ newhire_id: hireId, region, status: 'open' }, { onConflict: 'newhire_id', ignoreDuplicates: true })
      .select('id')
    becameOpen = (inserted?.length ?? 0) > 0
    if (becameOpen) await auditPm(admin, hireId, actor, `Project management request opened for the <strong>${esc(region)}</strong> team`)
  } else if (existing.status === 'cancelled') {
    // Moved back to PSPC & RCMP: reopen, unclaimed, in the plan's project region
    const { data: reopened } = await admin.from('pm_requests')
      .update({ status: 'open', region, claimed_by: null, claimed_at: null, updated_at: now })
      .eq('newhire_id', hireId)
      .eq('status', 'cancelled')
      .select('id')
    becameOpen = (reopened?.length ?? 0) > 0
    if (becameOpen) {
      await auditPm(admin, hireId, actor, existing.region === region
        ? `Project management request reopened for the <strong>${esc(region)}</strong> team`
        : `Project management request reopened and moved from <strong>${esc(existing.region)}</strong> to <strong>${esc(region)}</strong>`)
    }
  } else if (existing.status === 'open' && existing.region !== region) {
    // Unclaimed: moves to the new region's team. The conditions make it one move, whoever races it
    const { data: moved } = await admin.from('pm_requests')
      .update({ region, updated_at: now })
      .eq('newhire_id', hireId)
      .eq('status', 'open')
      .eq('region', existing.region)
      .select('id')
    becameOpen = (moved?.length ?? 0) > 0
    if (becameOpen) await auditPm(admin, hireId, actor, `Project management request moved from <strong>${esc(existing.region)}</strong> to <strong>${esc(region)}</strong>`)
    else return 'open'
  } else {
    return existing.status
  }

  // Goes to the new region's team only; its active members are looked up when it is sent. An empty
  // team shows on HR's card as "No active team for …" (pmRegionWarnings).
  if (becameOpen) {
    await queueNotification({ template: 'pm_request_created', hireId, payload: { region }, version: now })
  }
  return 'open'
}

// True when a claimed or finished request is held by a team other than this project region
export async function pmHeldInOtherRegion(admin: Admin, hireId: string, region: string): Promise<boolean> {
  const { data } = await admin.from('pm_requests').select('status, region').eq('newhire_id', hireId).maybeSingle()
  return !!data && (data.status === 'claimed' || data.status === 'done') && data.region !== region
}

// ── What a team member may see. The region always comes from the signed-in member's session. ──

export async function pmRequestInRegion(admin: Admin, region: RegionName, hireId: string) {
  const { data } = await admin
    .from('pm_requests')
    .select('newhire_id, status, claimed_by, claimed_at, completed_by, completed_at, region, dcc, standing_offer, project_name, project_location')
    .eq('newhire_id', hireId)
    .eq('region', region)
    .neq('status', 'cancelled')
    .maybeSingle()
  return data
}

//   open → unclaimed requests · mine → claimed by this member · done → completed
export async function pmRequestsInRegion(
  admin: Admin, { region, memberId, tab, limit, offset }: { region: RegionName; memberId: string; tab: PmTab; limit: number; offset: number },
) {
  let query = admin
    .from('pm_requests')
    .select('newhire_id, status, claimed_by, claimed_at, completed_at, region', { count: 'exact' })
    .eq('region', region)

  if (tab === 'open')      query = query.eq('status', 'open').order('created_at', { ascending: true })
  else if (tab === 'mine') query = query.eq('status', 'claimed').eq('claimed_by', memberId).order('claimed_at', { ascending: false })
  else                     query = query.eq('status', 'done').order('completed_at', { ascending: false })

  return query.range(offset, offset + limit - 1)
}

// Project block for HR: number and region from the manager plan, the four details from the
// project-management request. done is false while the request is open, claimed or missing.
export async function loadProjectBlock(admin: Admin, hireId: string): Promise<{ block: PmProjectBlock; done: boolean }> {
  const [{ data: plan }, { data: req }] = await Promise.all([
    admin.from('manager_plans').select('project_number, project_region').eq('newhire_id', hireId).maybeSingle(),
    admin.from('pm_requests')
      .select('status, dcc, standing_offer, project_name, project_location')
      .eq('newhire_id', hireId).maybeSingle(),
  ])
  return {
    block: {
      project_number:   plan?.project_number ?? null,
      project_region:   plan?.project_region ?? null,
      dcc:              req?.dcc ?? null,
      standing_offer:   req?.standing_offer ?? null,
      project_name:     req?.project_name ?? null,
      project_location: req?.project_location ?? null,
    },
    done: req?.status === 'done',
  }
}

// Queued once when a request is marked done
export async function queuePmDone(_admin: Admin, hireId: string): Promise<void> {
  await queueNotification({ template: 'pm_request_done', hireId, payload: {} })
}

// Card fields for a set of requests: hire name and start date, project number and manager from
// the plan, claimer name. Deliberately narrow: no clearance, payroll, banking, SIN or document data.
export async function describePmRequests(
  admin: Admin,
  requests: Pick<Database['public']['Tables']['pm_requests']['Row'], 'newhire_id' | 'status' | 'claimed_by' | 'claimed_at' | 'completed_at' | 'region'>[],
) {
  const hireIds = requests.map(r => r.newhire_id)
  if (hireIds.length === 0) return []

  const [{ data: hires }, { data: plans }] = await Promise.all([
    admin.from('profiles').select('id, full_name, start_date').in('id', hireIds),
    admin.from('manager_plans').select('newhire_id, manager_id, project_number').in('newhire_id', hireIds),
  ])
  const managerIds = [...new Set((plans ?? []).map(p => p.manager_id).filter(Boolean))]
  const [{ data: managers }, claimers] = await Promise.all([
    managerIds.length ? admin.from('managers').select('id, full_name').in('id', managerIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    memberNames(admin, requests.map(r => r.claimed_by)),
  ])

  const hireMap    = Object.fromEntries((hires ?? []).map(h => [h.id, h]))
  const planMap    = Object.fromEntries((plans ?? []).map(p => [p.newhire_id, p]))
  const managerMap = Object.fromEntries((managers ?? []).map(m => [m.id, m.full_name]))

  return requests.map(r => {
    const plan = planMap[r.newhire_id]
    return {
      hire_id:         r.newhire_id,
      name:            hireMap[r.newhire_id]?.full_name ?? '—',
      start_date:      hireMap[r.newhire_id]?.start_date ?? null,
      region:          r.region,
      project_number:  plan?.project_number ?? null,
      manager:         plan ? managerMap[plan.manager_id] ?? null : null,
      status:          r.status,
      claimed_by:      r.claimed_by,
      claimed_by_name: r.claimed_by ? claimers[r.claimed_by] ?? null : null,
      claimed_at:      r.claimed_at,
      completed_at:    r.completed_at,
    }
  })
}
