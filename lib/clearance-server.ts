import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, DocStatus, ClearanceInfo } from '@/types'
import { encrypt, decrypt, isEncrypted } from '@/lib/encrypt'
import { esc } from '@/lib/safe-html'
import { loadProjectBlock } from '@/lib/pm-server'
import {
  getClearanceRequirements, clearancePath, CLEARANCE_FILE_TYPES, CLEARANCE_FILES_BUCKET, packageLocked,
  CLEARANCE_MAX_BYTES, CLEARANCE_ID_DOC_TYPES, type ClearanceKind, type ClearanceRequirements,
} from '@/lib/clearance'

// Server-only clearance helpers. Never import from client code.

type Admin = SupabaseClient<Database>

// ── Requirements, from the manager's plan ────────────────────────────────────

export async function loadClearanceRequirements(admin: Admin, hireId: string): Promise<ClearanceRequirements> {
  const { data: plan } = await admin
    .from('manager_plans')
    .select('status, clearance_type')
    .eq('newhire_id', hireId)
    .maybeSingle()
  return getClearanceRequirements(plan)
}

// ── HR review: approve / flag. Writes only clearance_info. ───────────────────
// Never touches profiles.status, progress or the payroll queue (computeHireStatus is not involved).

export async function applyClearanceStatus(
  admin: Admin, hireId: string, status: unknown, reason: unknown, performedBy: string,
): Promise<{ ok: true; status: 'approved' | 'flagged' } | { ok: false; error: string; httpStatus: number }> {
  if (status !== 'approved' && status !== 'flagged') return { ok: false, error: 'Invalid request.', httpStatus: 400 }
  const reasonText = typeof reason === 'string' ? reason.trim().slice(0, 2000) : ''
  // Same rule as the other forms: a flag needs a reason the hire can act on
  if (status === 'flagged' && !reasonText) return { ok: false, error: 'A reason is required to flag this form.', httpStatus: 400 }

  const req = await loadClearanceRequirements(admin, hireId)
  if (!req.required) return { ok: false, error: 'Not found', httpStatus: 404 }

  // Locked while the PSPC & RCMP package is with the clearance reviewer
  const { data: tracking } = await admin.from('clearance_tracking').select('package_stage').eq('newhire_id', hireId).maybeSingle()
  if (packageLocked(tracking?.package_stage)) {
    return { ok: false, error: 'The package is with the clearance reviewer. The forms can be changed only if they send it back to HR.', httpStatus: 409 }
  }

  // Whole-form decision: every required form takes the same review (per-form review is
  // POST /api/hr/hires/[id]/clearance/review)
  const now = new Date().toISOString()
  const fileReview = status === 'approved' ? 'approved' as const : 'rejected' as const
  const fileReason = status === 'flagged' ? reasonText : null
  const { data: updated, error } = await admin
    .from('clearance_info')
    .update({
      form_status: status,
      flag_reason: status === 'flagged' ? reasonText : null,
      rcmp_review: fileReview, rcmp_reject_reason: fileReason, rcmp_reviewed_at: now, rcmp_reviewed_by: performedBy,
      ...(req.fingerprint
        ? { fingerprint_review: fileReview, fingerprint_reject_reason: fileReason, fingerprint_reviewed_at: now, fingerprint_reviewed_by: performedBy }
        : {}),
      updated_at:  now,
    })
    .eq('user_id', hireId)
    .not('submitted_at', 'is', null)
    .select('id')
  if (error) {
    console.error(`clearance status update failed (code ${error.code})`)
    return { ok: false, error: 'Update failed', httpStatus: 500 }
  }
  if (!updated || updated.length === 0) return { ok: false, error: 'Not found', httpStatus: 404 }

  const reasonNote = status === 'flagged' ? ` — ${esc(reasonText)}` : ''
  await admin.from('audit_log').insert({
    user_id:      hireId,
    action_type:  status === 'approved' ? 'green' : 'red',
    message:      `<strong>HR</strong> marked clearance form as <strong>${status}</strong>${reasonNote}`,
    performed_by: performedBy,
  })
  return { ok: true, status }
}

// ── Encryption: same list-based pattern as personal_info (lib/personal-fields.ts) ──

export const CLEARANCE_ENCRYPTED_FIELDS = ['legal_name_enc', 'place_of_birth_enc', 'dcn_enc'] as const
type EncryptedField = typeof CLEARANCE_ENCRYPTED_FIELDS[number]

// Encrypts the listed fields present on the row; empty values become null
export function encryptClearanceFields<T extends Partial<Record<EncryptedField, string | null>>>(row: T): T {
  const out: Record<string, unknown> = { ...row }
  for (const field of CLEARANCE_ENCRYPTED_FIELDS) {
    if (!(field in out)) continue
    const value = out[field]
    out[field] = typeof value === 'string' && value !== '' ? encrypt(value) : null
  }
  return out as T
}

// Decrypts one field. Failure gives null; only the field name is logged, never the value.
export function decryptClearanceField(row: Pick<ClearanceInfo, EncryptedField> | null, field: EncryptedField): string | null {
  const value = row?.[field]
  if (!isEncrypted(value)) return null
  try {
    return decrypt(value)
  } catch {
    console.error(`clearance: failed to decrypt field "${field}"`)
    return null
  }
}

// ── ID on file (existing documents, real document_type values) ──────────────

const ID_LABELS: Record<string, string> = { drivers_license: "Driver's License", alternative_id: 'Alternative ID' }
const STATUS_RANK: Record<string, number> = { approved: 3, review: 2, pending: 1 }

export async function clearanceIdOnFile(admin: Admin, hireId: string): Promise<{ status: DocStatus; label: string } | null> {
  const { data } = await admin
    .from('newhire_documents')
    .select('document_type, form_status')
    .eq('user_id', hireId)
    .in('document_type', [...CLEARANCE_ID_DOC_TYPES])
  const usable = (data ?? []).filter(d => d.form_status !== 'rejected')
  if (usable.length === 0) return null
  const best = usable.sort((a, b) => (STATUS_RANK[b.form_status] ?? 0) - (STATUS_RANK[a.form_status] ?? 0))[0]
  return { status: best.form_status, label: ID_LABELS[best.document_type] ?? 'ID' }
}

// ── 60-second signed URLs ────────────────────────────────────────────────────

export async function signedClearanceUrl(
  admin:  Admin,
  bucket: string,
  path:   string,
  download?: string,
): Promise<string | null> {
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(path, 60, download ? { download } : undefined)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

// "RCMP-form-Jane-Doe.xlsx": letters, digits and hyphens only
export function clearanceDownloadName(prefix: string, legalName: string | null, ext: string): string {
  const name = (legalName ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 80)
  const safeExt = ext.replace(/[^a-z0-9]/g, '')
  return `${prefix}${name ? `-${name}` : ''}.${safeExt}`
}

// ── Upload checks ────────────────────────────────────────────────────────────

const SIGNATURES: Record<string, number[][]> = {
  pdf:  [[0x25, 0x50, 0x44, 0x46]],                 // %PDF
  png:  [[0x89, 0x50, 0x4e, 0x47]],                 // \x89PNG
  jpg:  [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]],
  xlsx: [[0x50, 0x4b, 0x03, 0x04]],                 // PK.. (zip)
}

export type VerifiedUpload = { ok: true; ext: string } | { ok: false }

// The client says which path it uploaded to. It must be exactly {userId}/{kind}.{ext} with an
// allowed extension for that kind; the object must exist, be at most 10 MB, carry the matching
// content type and start with the expected file signature. A failing upload is removed.
export async function verifyClearanceUpload(admin: Admin, userId: string, kind: ClearanceKind, path: string): Promise<VerifiedUpload> {
  const allowed = CLEARANCE_FILE_TYPES[kind]
  const ext = Object.keys(allowed).find(e => path === clearancePath(userId, kind, e))
  if (!ext) return { ok: false }

  const bucket = admin.storage.from(CLEARANCE_FILES_BUCKET)
  const { data: blob, error } = await bucket.download(path)
  if (error || !blob) return { ok: false }

  const contentType = (blob.type || '').split(';')[0].trim().toLowerCase()
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  const signatureOk = (SIGNATURES[ext] ?? []).some(sig => sig.every((byte, i) => head[i] === byte))

  if (blob.size === 0 || blob.size > CLEARANCE_MAX_BYTES || contentType !== allowed[ext] || !signatureOk) {
    const { error: removeError } = await bucket.remove([path])
    if (removeError) console.error('clearance: failed to remove a rejected upload')
    return { ok: false }
  }
  return { ok: true, ext }
}

// Display name for an uploaded file: control characters stripped, capped at 150
export function cleanClearanceFileName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 150).trim()
  return name || fallback
}

// ── HR view: non-sensitive fields, has_* flags and the legal name; never place of birth or DCN ──

export async function loadHrClearanceView(admin: Admin, hireId: string) {
  const req = await loadClearanceRequirements(admin, hireId)
  if (!req.required) return { required: false as const }

  const [{ data: row }, { data: profile }, project, { data: tracking }, id, { data: history }] = await Promise.all([
    admin.from('clearance_info').select('*').eq('user_id', hireId).maybeSingle(),
    admin.from('profiles').select('office_location').eq('id', hireId).maybeSingle(),
    loadProjectBlock(admin, hireId),
    admin.from('clearance_tracking').select('*').eq('newhire_id', hireId).maybeSingle(),
    clearanceIdOnFile(admin, hireId),
    admin.from('clearance_stage_history')
      .select('id, from_stage, to_stage, actor_id, note, created_at')
      .eq('newhire_id', hireId).order('created_at', { ascending: false }).limit(20),
  ])

  // Names of everyone who reviewed a form, marked a step or moved the package
  const actorIds = [
    tracking?.pspc_sent_by, tracking?.rcmp_sent_by, tracking?.cleared_by, tracking?.stage_updated_by, tracking?.sent_to_bgis_by,
    row?.rcmp_reviewed_by, row?.fingerprint_reviewed_by, ...(history ?? []).map(h => h.actor_id),
  ].filter((v): v is string => !!v)
  const { data: actors } = actorIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', actorIds)
    : { data: [] }
  const actorName = (uid: string | null | undefined) => (uid && actors?.find(a => a.id === uid)?.full_name) || null

  const office = profile?.office_location ?? null
  const extOf  = (p: string | null | undefined) => (p ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : null)

  return {
    required:           true as const,
    type:               req.type,
    fingerprint:        req.fingerprint,
    rcmp:               req.rcmp,
    status:             (row?.form_status ?? 'pending') as ClearanceInfo['form_status'],
    flag_reason:        row?.flag_reason ?? null,
    submitted_at:       row?.submitted_at ?? null,
    legal_name:         decryptClearanceField(row, 'legal_name_enc'),
    has_place_of_birth: !!row?.place_of_birth_enc,
    has_dcn:            !!row?.dcn_enc,
    has_fingerprint:    !!row?.fingerprint_path,
    has_rcmp:           !!row?.rcmp_path,
    fingerprint_name:   row?.fingerprint_name ?? null,
    rcmp_name:          row?.rcmp_name ?? null,
    fingerprint_ext:    extOf(row?.fingerprint_path),
    rcmp_ext:           extOf(row?.rcmp_path),
    id,
    office_location:    office,
    // PSPC & RCMP only: plan number and region plus the project-management details. pm_done false
    // shows "Waiting on project management" in the tracker; it never blocks the tracker buttons.
    project: req.fingerprint ? project.block : null,
    pm_done: req.fingerprint ? project.done : null,
    tracking: {
      pspc_sent_at:      tracking?.pspc_sent_at ?? null,
      pspc_sent_by_name: actorName(tracking?.pspc_sent_by),
      rcmp_sent_at:      tracking?.rcmp_sent_at ?? null,
      rcmp_sent_by_name: actorName(tracking?.rcmp_sent_by),
      rcmp_recipient:    tracking?.rcmp_recipient ?? null,
      cleared_at:        tracking?.cleared_at ?? null,
      cleared_by_name:   actorName(tracking?.cleared_by),
    },
    // Per-form review
    reviews: {
      rcmp: {
        status:      row?.rcmp_review ?? 'pending',
        reason:      row?.rcmp_reject_reason ?? null,
        reviewed_at: row?.rcmp_reviewed_at ?? null,
        by_name:     actorName(row?.rcmp_reviewed_by),
      },
      fingerprint: req.fingerprint ? {
        status:      row?.fingerprint_review ?? 'pending',
        reason:      row?.fingerprint_reject_reason ?? null,
        reviewed_at: row?.fingerprint_reviewed_at ?? null,
        by_name:     actorName(row?.fingerprint_reviewed_by),
      } : null,
    },
    // PSPC & RCMP package (stage null until sent); HR sees it but cannot move it
    package: req.fingerprint ? {
      stage:            tracking?.package_stage ?? null,
      sent_at:          tracking?.package_sent_at ?? null,
      stage_updated_at: tracking?.stage_updated_at ?? null,
      stage_by_name:    actorName(tracking?.stage_updated_by),
      returned_note:    tracking?.returned_note ?? null,
      returned_at:      tracking?.returned_at ?? null,
      done_at:          tracking?.done_at ?? null,
      history: (history ?? []).map(h => ({
        id: h.id, from: h.from_stage, to: h.to_stage, at: h.created_at, by_name: actorName(h.actor_id), note: h.note,
      })),
    } : null,
    // RCMP only: "Sent to BGIS"
    bgis: req.type === 'rcmp' ? {
      sent:    tracking?.sent_to_bgis ?? false,
      at:      tracking?.sent_to_bgis_at ?? null,
      by_name: actorName(tracking?.sent_to_bgis_by),
    } : null,
  }
}

export type HrClearanceView = Awaited<ReturnType<typeof loadHrClearanceView>>
