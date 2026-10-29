import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, RegionName, RegionTeamMember } from '@/types'
import { isRegion, needsPmRequest } from '@/lib/pm'
import { queueNotification, hrNotifyEmails, appUrl } from '@/lib/notify'

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

// Keeps the hire's pm_requests row in step with the manager plan. Idempotent; safe to call after
// every plan save or reassignment.
//   PSPC & RCMP submitted, valid region → request exists (created, or reopened if it was cancelled)
//   PSPC & RCMP submitted, no region    → no request; HR sees "Set region"
//   region changed while open/claimed   → moved to the new region's team, unclaimed
//   anything else                       → an open or claimed request is cancelled (done is kept)
export async function syncPmRequest(admin: Admin, hireId: string): Promise<PmSyncResult> {
  const [{ data: plan }, { data: hire }, { data: existing }] = await Promise.all([
    admin.from('manager_plans').select('status, clearance_type').eq('newhire_id', hireId).maybeSingle(),
    admin.from('profiles').select('full_name, region').eq('id', hireId).maybeSingle(),
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

  const region = isRegion(hire?.region) ? hire.region : null
  if (!region) return existing && existing.status !== 'cancelled' ? existing.status : 'needs_region'

  let becameOpen = false
  if (!existing) {
    // A concurrent call loses the insert race and is ignored
    const { data: inserted } = await admin.from('pm_requests')
      .upsert({ newhire_id: hireId, region, status: 'open' }, { onConflict: 'newhire_id', ignoreDuplicates: true })
      .select('id')
    becameOpen = (inserted?.length ?? 0) > 0
  } else if (existing.status === 'cancelled') {
    // Moved back to PSPC & RCMP: reopen, unclaimed, in the hire's current region
    const { data: reopened } = await admin.from('pm_requests')
      .update({ status: 'open', region, claimed_by: null, claimed_at: null, updated_at: now })
      .eq('newhire_id', hireId)
      .eq('status', 'cancelled')
      .select('id')
    becameOpen = (reopened?.length ?? 0) > 0
  } else if ((existing.status === 'open' || existing.status === 'claimed') && existing.region !== region) {
    // The hire's region changed while the request was open or claimed: the old region's request is
    // cancelled and a fresh, unclaimed one opens for the new region's team. A done request never changes.
    const { data: moved } = await admin.from('pm_requests')
      .update({ status: 'open', region, claimed_by: null, claimed_at: null, updated_at: now })
      .eq('newhire_id', hireId)
      .in('status', ['open', 'claimed'])
      .neq('region', region)
      .select('id')
    becameOpen = (moved?.length ?? 0) > 0
  } else {
    return existing.status
  }

  if (becameOpen) {
    const team = await activeRegionMembers(admin, region)
    if (team.length > 0) {
      await queueNotification({
        template:  'pm_request_created',
        to:        team.map(m => m.member_email),
        dedupeKey: `pm_request_created:${hireId}:${region}`,
        payload:   { newhireId: hireId, hireName: hire?.full_name ?? '', link: appUrl(`/project-mgmt/newhire/${hireId}`) },
      })
    }
  }
  return 'open'
}

// Queued once when a request is marked done
export async function queuePmDone(admin: Admin, hireId: string): Promise<void> {
  const { data: hire } = await admin.from('profiles').select('full_name').eq('id', hireId).maybeSingle()
  await queueNotification({
    template:  'pm_request_done',
    to:        hrNotifyEmails(),
    dedupeKey: `pm_request_done:${hireId}`,
    payload:   { newhireId: hireId, hireName: hire?.full_name ?? '', link: appUrl(`/hr/newhire/${hireId}`) },
  })
}

// Card fields for a set of requests: hire name and start date, branch and manager from the plan,
// claimer name. Deliberately narrow: no clearance, payroll, banking, SIN or document data.
export async function describePmRequests(
  admin: Admin,
  requests: Pick<Database['public']['Tables']['pm_requests']['Row'], 'newhire_id' | 'status' | 'claimed_by' | 'claimed_at' | 'completed_at' | 'region'>[],
) {
  const hireIds = requests.map(r => r.newhire_id)
  if (hireIds.length === 0) return []

  const [{ data: hires }, { data: plans }] = await Promise.all([
    admin.from('profiles').select('id, full_name, start_date').in('id', hireIds),
    admin.from('manager_plans').select('newhire_id, manager_id, project_branch').in('newhire_id', hireIds),
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
      branch:          plan?.project_branch ?? null,
      manager:         plan ? managerMap[plan.manager_id] ?? null : null,
      status:          r.status,
      claimed_by:      r.claimed_by,
      claimed_by_name: r.claimed_by ? claimers[r.claimed_by] ?? null : null,
      claimed_at:      r.claimed_at,
      completed_at:    r.completed_at,
    }
  })
}
