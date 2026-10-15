import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, DocStatus, ClearanceInfo } from '@/types'
import { encrypt, decrypt, isEncrypted } from '@/lib/encrypt'
import { esc } from '@/lib/safe-html'
import {
  getClearanceRequirements, clearancePath, CLEARANCE_FILE_TYPES, CLEARANCE_FILES_BUCKET,
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

  const { data: updated, error } = await admin
    .from('clearance_info')
    .update({
      form_status: status,
      flag_reason: status === 'flagged' ? reasonText : null,
      updated_at:  new Date().toISOString(),
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

  const [{ data: row }, { data: profile }, { data: plan }, { data: tracking }, id] = await Promise.all([
    admin.from('clearance_info').select('*').eq('user_id', hireId).maybeSingle(),
    admin.from('profiles').select('office_location').eq('id', hireId).maybeSingle(),
    admin.from('manager_plans')
      .select('project_number, project_name, project_region, project_location, project_branch')
      .eq('newhire_id', hireId).maybeSingle(),
    admin.from('clearance_tracking').select('*').eq('newhire_id', hireId).maybeSingle(),
    clearanceIdOnFile(admin, hireId),
  ])

  // Names of the HR users who marked each step
  const actorIds = [tracking?.pspc_sent_by, tracking?.rcmp_sent_by, tracking?.cleared_by].filter((v): v is string => !!v)
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
    project: req.fingerprint ? {
      number:   plan?.project_number   ?? null,
      name:     plan?.project_name     ?? null,
      region:   plan?.project_region   ?? null,
      location: plan?.project_location ?? null,
      branch:   plan?.project_branch   ?? null,
    } : null,
    tracking: {
      pspc_sent_at:      tracking?.pspc_sent_at ?? null,
      pspc_sent_by_name: actorName(tracking?.pspc_sent_by),
      rcmp_sent_at:      tracking?.rcmp_sent_at ?? null,
      rcmp_sent_by_name: actorName(tracking?.rcmp_sent_by),
      rcmp_recipient:    tracking?.rcmp_recipient ?? null,
      cleared_at:        tracking?.cleared_at ?? null,
      cleared_by_name:   actorName(tracking?.cleared_by),
    },
  }
}

export type HrClearanceView = Awaited<ReturnType<typeof loadHrClearanceView>>
