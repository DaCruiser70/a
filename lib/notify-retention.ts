import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'

// Server only. Removes finished rows from notification_outbox. Only ever 'sent' and 'dead' rows:
// 'queued', 'sending' and 'failed' (waiting for a retry) are never touched. Every delete re-checks
// the status (and age) in its own WHERE clause, and runs in small batches.
//
// Safe to delete: the dedupe key of every notification is kept in notification_keys (no address, no
// content), which is what stops an event being queued again, and daily reminders read their history
// and start dates from there too. Deleting outbox rows never lets anything be sent twice; as a guard,
// a row is only deleted once its key is confirmed in the ledger.
// audit_log is never touched here.

type Admin = SupabaseClient<Database>

// Days after a row's last update before cleanup removes it. Change them here.
export const OUTBOX_RETENTION_DAYS = { sent: 30, dead: 30 } as const

export const CLEANUP_BATCH_SIZE  = 200
export const CLEANUP_MAX_BATCHES = 25   // at most 5,000 rows per status per run, so a run stays short

type Status = keyof typeof OUTBOX_RETENTION_DAYS
type Options = { apply: boolean; now?: Date; onlyIds?: string[] }   // onlyIds: tests only

export function retentionCutoff(status: Status, now = new Date()): string {
  return new Date(now.getTime() - OUTBOX_RETENTION_DAYS[status] * 86_400_000).toISOString()
}

// Deletes (or, without apply, counts) rows with this status, optionally only those last updated
// before `before`, in batches. A row is deleted only when its dedupe key is confirmed in
// notification_keys: without the ledger (migration not run) or with a key missing, the row stays.
async function sweep(admin: Admin, status: 'sent' | 'dead', before: string | null, opts: Options): Promise<number> {
  const select = (columns: string, head = false) => {
    let q = admin.from('notification_outbox').select(columns, { count: 'exact', head }).eq('status', status)
    if (before) q = q.lt('updated_at', before)
    if (opts.onlyIds) q = q.in('id', opts.onlyIds)
    return q
  }
  if (!opts.apply) {
    const { count, error } = await select('id', true)
    if (error) throw new Error(`cleanup count failed (code ${error.code})`)
    return count ?? 0
  }

  let removed = 0
  let skipped = 0   // rows kept because their key is not in the ledger: stepped over, never deleted
  for (let batch = 0; batch < CLEANUP_MAX_BATCHES; batch++) {
    const { data, error } = await select('id, dedupe_key').order('updated_at', { ascending: true })
      .range(skipped, skipped + CLEANUP_BATCH_SIZE - 1)
    if (error) throw new Error(`cleanup read failed (code ${error.code})`)
    const rows = (data ?? []) as unknown as { id: string; dedupe_key: string }[]
    if (!rows.length) break

    const { data: keys, error: keyError } = await admin.from('notification_keys').select('dedupe_key').in('dedupe_key', rows.map(r => r.dedupe_key))
    if (keyError) throw new Error(`cleanup key check failed (code ${keyError.code})`)
    const recorded  = new Set((keys ?? []).map(k => k.dedupe_key))
    const deletable = rows.filter(r => recorded.has(r.dedupe_key))
    skipped += rows.length - deletable.length

    if (deletable.length) {
      let del = admin.from('notification_outbox').delete().in('id', deletable.map(r => r.id)).eq('status', status)
      if (before) del = del.lt('updated_at', before)
      const { data: gone, error: delError } = await del.select('id')
      if (delError) throw new Error(`cleanup delete failed (code ${delError.code})`)
      removed += gone?.length ?? 0
    }
    if (rows.length < CLEANUP_BATCH_SIZE) break
  }
  return removed
}

// Daily retention cleanup: sent and dead rows older than OUTBOX_RETENTION_DAYS
export async function purgeOldNotifications(admin: Admin, opts: Options): Promise<{ sent: number; dead: number }> {
  const now = opts.now ?? new Date()
  return {
    sent: await sweep(admin, 'sent', retentionCutoff('sent', now), opts),
    dead: await sweep(admin, 'dead', retentionCutoff('dead', now), opts),
  }
}

// HR's "Clear dead notifications": every dead row, whatever its age
export async function clearDeadNotifications(admin: Admin, opts: Options): Promise<number> {
  return sweep(admin, 'dead', null, opts)
}

// Audit messages: counts and fixed words only
export function cleanupAuditMessage(counts: { sent: number; dead: number }): string {
  const n = Math.trunc(counts.sent) + Math.trunc(counts.dead)
  return `<strong>Portal</strong> notification cleanup removed ${Math.trunc(counts.sent)} sent and ${Math.trunc(counts.dead)} dead notification${n === 1 ? '' : 's'} (sent older than ${OUTBOX_RETENTION_DAYS.sent} days, dead older than ${OUTBOX_RETENTION_DAYS.dead} days)`
}

export function clearDeadAuditMessage(cleared: number): string {
  return `<strong>HR</strong> cleared ${Math.trunc(cleared)} dead notification${cleared === 1 ? '' : 's'}`
}

export async function countDeadNotifications(admin: Admin): Promise<number> {
  const { count, error } = await admin.from('notification_outbox').select('id', { count: 'exact', head: true }).eq('status', 'dead')
  if (error) throw new Error(`dead count failed (code ${error.code})`)
  return count ?? 0
}

// One audit entry per cleanup run, counts only. audit_log needs a person to file it under, and a
// scheduled run has none: it goes on the first active HR account (by creation date), with no actor.
// Returns false when there is no HR account to file it under.
export async function auditCleanupRun(admin: Admin, counts: { sent: number; dead: number }): Promise<boolean> {
  const { data: hr, error } = await admin.rpc('notify_active_accounts', { p_role: 'hr', p_ids: null })
  if (error || !hr?.length) return false
  const { data: first } = await admin.from('profiles').select('id').in('id', hr.map(a => a.id))
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!first) return false
  const { error: insertError } = await admin.from('audit_log').insert({
    user_id: first.id, performed_by: null, action_type: 'navy', message: cleanupAuditMessage(counts),
  })
  if (insertError) console.error(`[cleanup] audit insert failed (code ${insertError.code})`)
  return !insertError
}
