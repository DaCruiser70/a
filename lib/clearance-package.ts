import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'
import { esc } from '@/lib/safe-html'
import { queueNotification, hrNotifyEmails, appUrl } from '@/lib/notify'
import { loadProjectBlock } from '@/lib/pm-server'
import { missingPmFields, PM_DETAIL_LABELS } from '@/lib/pm'
import { REVIEWER_MOVES, type PackageStage, type ReviewerAction } from '@/lib/clearance'
import { loadClearanceRequirements, clearanceIdOnFile, loadHrClearanceView } from '@/lib/clearance-server'

// Server only. The PSPC & RCMP clearance package: readiness, the automatic send, HR's resend and
// the reviewer's stage moves. Every move goes through move_clearance_stage (one conditional
// UPDATE plus its history row), so a stage can never be skipped or applied twice.
// Clearance never touches profiles.status, computeHireStatus, progress or payroll.

type Admin = SupabaseClient<Database>

export type PackageReadiness = { applies: boolean; ready: boolean; waiting: string[] }

// What still stands between this hire and an automatic send (PSPC & RCMP only)
export async function packageReadiness(admin: Admin, hireId: string): Promise<PackageReadiness> {
  const req = await loadClearanceRequirements(admin, hireId)
  if (req.type !== 'pspc_rcmp') return { applies: false, ready: false, waiting: [] }

  const [{ data: info }, idDoc, project, { data: pm }] = await Promise.all([
    admin.from('clearance_info').select('submitted_at, rcmp_review, fingerprint_review').eq('user_id', hireId).maybeSingle(),
    clearanceIdOnFile(admin, hireId),
    loadProjectBlock(admin, hireId),
    admin.from('pm_requests').select('status').eq('newhire_id', hireId).maybeSingle(),
  ])

  const waiting: string[] = []
  if (!info?.submitted_at) waiting.push('The hire to submit the clearance form')
  if (info?.rcmp_review !== 'approved')        waiting.push('RCMP form approved by HR')
  if (info?.fingerprint_review !== 'approved') waiting.push('PSPC fingerprint form approved by HR')
  if (!idDoc) waiting.push('ID document on file (driver’s licence or alternate ID)')
  if (!project.block.project_number) waiting.push('Project number (manager’s plan)')
  if (!project.block.project_region) waiting.push('Project region (manager’s plan)')
  for (const f of missingPmFields(project.block)) waiting.push(`${PM_DETAIL_LABELS[f]} (project management)`)
  // The project manager's answers are final only once they mark their request done
  if (pm?.status !== 'done') waiting.push('Project management to mark their request done')

  return { applies: true, ready: waiting.length === 0, waiting }
}

async function nameOf(admin: Admin, id: string | null | undefined): Promise<string | null> {
  if (!id) return null
  const { data } = await admin.from('profiles').select('full_name').eq('id', id).maybeSingle()
  return data?.full_name ?? null
}

// Everyone holding the 'clearance' role
export async function clearanceReviewerEmails(admin: Admin): Promise<string[]> {
  const { data } = await admin.from('profiles').select('aem_email').contains('roles', ['clearance'])
  return [...new Set((data ?? []).map(p => p.aem_email).filter((e): e is string => !!e))]
}

async function notifyPackage(admin: Admin, hireId: string, event: 'sent' | 'returned' | 'done', at: string) {
  const hireName = (await nameOf(admin, hireId)) ?? ''
  if (event === 'sent') {
    const to = await clearanceReviewerEmails(admin)
    if (to.length === 0) return
    await queueNotification({
      template: 'clearance_package_sent', to, dedupeKey: `clearance_package_sent:${hireId}:${at}`,
      payload:  { newhireId: hireId, hireName, link: appUrl(`/clearance/newhire/${hireId}`) },
    })
  } else {
    await queueNotification({
      template:  event === 'returned' ? 'clearance_package_returned' : 'clearance_package_done',
      to:        hrNotifyEmails(),
      dedupeKey: `clearance_package_${event}:${hireId}:${at}`,
      payload:   { newhireId: hireId, hireName, link: appUrl(`/hr/newhire/${hireId}?tab=clearance`) },
    })
  }
}

type MoveResult = { ok: true; stage: PackageStage } | { ok: false; reason: 'conflict' | 'invalid' | 'note_required' | 'not_ready' | 'error'; waiting?: string[] }

async function move(
  admin: Admin, hireId: string, expected: 'unsent' | PackageStage, to: PackageStage, actorId: string | null, note: string | null,
): Promise<MoveResult> {
  const { data, error } = await admin.rpc('move_clearance_stage', {
    p_newhire_id: hireId, p_expected: expected, p_to: to, p_actor_id: actorId, p_note: note,
  })
  if (error) {
    console.error(`[clearance-package] move failed (code ${error.code})`)
    return { ok: false, reason: 'error' }
  }
  if (data !== 'ok') return { ok: false, reason: data === 'note_required' || data === 'invalid' ? data : 'conflict' }
  return { ok: true, stage: to }
}

async function stampedAt(admin: Admin, hireId: string, column: 'package_sent_at' | 'returned_at' | 'done_at'): Promise<string> {
  const { data } = await admin.from('clearance_tracking').select(column).eq('newhire_id', hireId).maybeSingle()
  return (data as Record<string, string | null> | null)?.[column] ?? new Date().toISOString()
}

// Called after anything that can complete the package changes (form review, ID documents, project
// details, the manager's plan). Sends only a package that has never been sent and is ready.
// Never throws; a failure is logged by code only.
export async function syncClearancePackage(admin: Admin, hireId: string, actorId: string | null): Promise<void> {
  try {
    const { data: tracking } = await admin.from('clearance_tracking').select('package_stage').eq('newhire_id', hireId).maybeSingle()
    if (tracking?.package_stage) return
    const readiness = await packageReadiness(admin, hireId)
    if (!readiness.applies || !readiness.ready) return

    // The portal sends it, not a person: no actor on the stage history
    const result = await move(admin, hireId, 'unsent', 'needs_review', null, null)
    if (!result.ok) return   // another request sent it first

    await admin.from('audit_log').insert({
      user_id: hireId, action_type: 'navy', performed_by: actorId,
      message: '<strong>Portal</strong> sent the clearance package to the clearance reviewer',
    })
    await notifyPackage(admin, hireId, 'sent', await stampedAt(admin, hireId, 'package_sent_at'))
  } catch {
    console.error('[clearance-package] sync failed')
  }
}

// HR "Fix and resend": Returned → Needs review, only when the package is ready again
export async function resendPackage(admin: Admin, hireId: string, hrUserId: string): Promise<MoveResult> {
  const readiness = await packageReadiness(admin, hireId)
  if (!readiness.applies) return { ok: false, reason: 'invalid' }
  if (!readiness.ready) return { ok: false, reason: 'not_ready', waiting: readiness.waiting }

  const result = await move(admin, hireId, 'returned', 'needs_review', hrUserId, null)
  if (!result.ok) return result

  const who = (await nameOf(admin, hrUserId)) ?? 'HR'
  await admin.from('audit_log').insert({
    user_id: hireId, action_type: 'navy', performed_by: hrUserId,
    message: `<strong>${esc(who)}</strong> resent the clearance package to the clearance reviewer`,
  })
  await notifyPackage(admin, hireId, 'sent', await stampedAt(admin, hireId, 'package_sent_at'))
  return result
}

// The reviewer's moves: start (Needs review → In process), done (In process → Done) and return
// (Needs review or In process → Returned, note required). expected is the stage the reviewer saw.
export async function reviewerMove(
  admin: Admin, hireId: string, reviewerId: string, action: ReviewerAction, expected: PackageStage, note: string | null,
): Promise<MoveResult> {
  const rule = REVIEWER_MOVES[action]
  if (!rule.from.includes(expected)) return { ok: false, reason: 'invalid' }
  const result = await move(admin, hireId, expected, rule.to, reviewerId, action === 'return' ? note : null)
  if (!result.ok) return result

  const who = (await nameOf(admin, reviewerId)) ?? 'Clearance reviewer'
  const message = {
    start:  `<strong>${esc(who)}</strong> (clearance review) moved the clearance package to <strong>In process</strong>`,
    done:   `<strong>${esc(who)}</strong> (clearance review) marked the clearance package <strong>Done</strong>`,
    return: `<strong>${esc(who)}</strong> (clearance review) sent the clearance package back to HR`,
  }[action]
  await admin.from('audit_log').insert({
    user_id: hireId, action_type: action === 'return' ? 'red' : action === 'done' ? 'green' : 'navy',
    performed_by: reviewerId, message,
  })
  if (action === 'return') await notifyPackage(admin, hireId, 'returned', await stampedAt(admin, hireId, 'returned_at'))
  if (action === 'done')   await notifyPackage(admin, hireId, 'done', await stampedAt(admin, hireId, 'done_at'))
  return result
}

// The reviewer may see a hire only when the clearance is PSPC & RCMP and the package has been sent
export async function reviewerCanSee(admin: Admin, hireId: string): Promise<{ stage: PackageStage } | null> {
  const req = await loadClearanceRequirements(admin, hireId)
  if (req.type !== 'pspc_rcmp') return null
  const { data } = await admin.from('clearance_tracking').select('package_stage').eq('newhire_id', hireId).maybeSingle()
  return data?.package_stage ? { stage: data.package_stage } : null
}

// HR's Clearance tab: the base view plus the "Waiting on:" checklist for a package not yet sent
export async function loadHrClearanceFull(admin: Admin, hireId: string) {
  const view = await loadHrClearanceView(admin, hireId)
  if (!view.required) return view
  const readiness = view.package ? await packageReadiness(admin, hireId) : null
  return { ...view, ready: readiness?.ready ?? false, waiting: readiness?.waiting ?? [] }
}
export type HrClearanceFullView = Awaited<ReturnType<typeof loadHrClearanceFull>>
