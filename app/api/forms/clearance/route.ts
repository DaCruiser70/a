import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { queueNotification, hrNotifyEmails, appUrl } from '@/lib/notify'
import {
  CLEARANCE_FILES_BUCKET, CLEARANCE_TEMPLATES_BUCKET, CLEARANCE_TEMPLATE_FILES,
  normalizeDcn, isValidDcn, packageLocked, type ClearanceKind,
} from '@/lib/clearance'
import {
  loadClearanceRequirements, encryptClearanceFields, decryptClearanceField, clearanceIdOnFile,
  verifyClearanceUpload, cleanClearanceFileName,
} from '@/lib/clearance-server'
import type { Database } from '@/types'

type ClearanceUpsert = Database['public']['Tables']['clearance_info']['Insert']

// The same answer for "not unlocked" and "not allowed", so nothing about the plan leaks
const FORBIDDEN = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })

const pathField = z.string().max(200).nullable().optional()
const nameField = z.string().max(300).optional()

const BodySchema = z.strictObject({
  legalName:         z.string().trim().min(1).max(200),
  placeOfBirth:      z.string().trim().min(1).max(200),
  dcn:               z.string().max(40).optional().default(''),
  fingerprintPath:   pathField,
  fingerprintName:   nameField,
  removeFingerprint: z.boolean().optional().default(false),
  rcmpPath:          pathField,
  rcmpName:          nameField,
  removeRcmp:        z.boolean().optional().default(false),
})

async function templateExists(admin: ReturnType<typeof createServiceClient>, kind: ClearanceKind): Promise<boolean> {
  const file = CLEARANCE_TEMPLATE_FILES[kind]
  const { data, error } = await admin.storage.from(CLEARANCE_TEMPLATES_BUCKET).list('', { search: file })
  return !error && !!data?.some(o => o.name === file)
}

// The hire's own clearance form, decrypted server-side for pre-filling
export async function GET() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()
  const req = await loadClearanceRequirements(admin, user.id)
  if (!req.required) return FORBIDDEN()

  const [{ data: row }, { data: profile }, id, fingerprintTemplate, rcmpTemplate] = await Promise.all([
    admin.from('clearance_info').select('*').eq('user_id', user.id).maybeSingle(),
    admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    clearanceIdOnFile(admin, user.id),
    req.fingerprint ? templateExists(admin, 'fingerprint') : Promise.resolve(false),
    templateExists(admin, 'rcmp'),
  ])

  return NextResponse.json({
    type:        req.type,
    fingerprint: req.fingerprint,
    rcmp:        req.rcmp,
    templates:   { fingerprint: fingerprintTemplate, rcmp: rcmpTemplate },
    id,
    existing: {
      legalName:    decryptClearanceField(row, 'legal_name_enc') ?? profile?.full_name ?? '',
      placeOfBirth: decryptClearanceField(row, 'place_of_birth_enc') ?? '',
      dcn:          decryptClearanceField(row, 'dcn_enc') ?? '',
      // File details only — storage paths never leave the server
      fingerprint:  row?.fingerprint_path ? { name: row.fingerprint_name ?? 'Fingerprint form' } : null,
      rcmp:         row?.rcmp_path        ? { name: row.rcmp_name        ?? 'RCMP form' }        : null,
      formStatus:   row?.form_status ?? null,
      flagReason:   row?.flag_reason ?? null,
    },
  })
}

export async function POST(request: Request) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('forms:clearance', user.id), 20, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Please check the form and try again.' }, { status: 400 })
  const body = parsed.data

  const admin = createServiceClient()
  const req = await loadClearanceRequirements(admin, user.id)
  if (!req.required) return FORBIDDEN()

  const dcn = normalizeDcn(body.dcn)
  if (dcn && (!req.fingerprint || !isValidDcn(dcn))) {
    return NextResponse.json({ error: 'The DCN must be exactly 20 digits.' }, { status: 400 })
  }

  // ID lives in Documents; it must be on file and not rejected
  if (!(await clearanceIdOnFile(admin, user.id))) {
    return NextResponse.json({ error: 'Please upload your ID in Documents first.' }, { status: 400 })
  }

  const { data: existing } = await admin
    .from('clearance_info')
    .select('fingerprint_path, rcmp_path, submitted_at')
    .eq('user_id', user.id)
    .maybeSingle()

  // While the PSPC & RCMP package is with the clearance reviewer the forms cannot change
  const { data: tracking } = await admin.from('clearance_tracking').select('package_stage').eq('newhire_id', user.id).maybeSingle()
  if (packageLocked(tracking?.package_stage)) {
    return NextResponse.json({ error: 'Your clearance package is with the reviewer, so it can’t be changed right now. HR will contact you if anything needs fixing.' }, { status: 409 })
  }

  // Each file: a new upload (validated), keep what is on file, or remove it at this resubmit
  type FileResult = { path: string | null; name: string | null; changed: boolean }
  async function resolveFile(kind: ClearanceKind, newPath: string | null | undefined, newName: string | undefined, remove: boolean, oldPath: string | null): Promise<FileResult | 'invalid'> {
    if (newPath) {
      const check = await verifyClearanceUpload(admin, user.id, kind, newPath)
      if (!check.ok) return 'invalid'
      return { path: newPath, name: cleanClearanceFileName(newName, `${kind}.${check.ext}`), changed: true }
    }
    if (remove) return { path: null, name: null, changed: !!oldPath }
    return { path: oldPath, name: null, changed: false }
  }

  const fingerprint = req.fingerprint
    ? await resolveFile('fingerprint', body.fingerprintPath, body.fingerprintName, body.removeFingerprint, existing?.fingerprint_path ?? null)
    : null
  const rcmp = await resolveFile('rcmp', body.rcmpPath, body.rcmpName, body.removeRcmp, existing?.rcmp_path ?? null)

  if (fingerprint === 'invalid' || rcmp === 'invalid') {
    return NextResponse.json({ error: 'One of the uploaded files could not be accepted. Check the file type and size, then upload it again.' }, { status: 400 })
  }
  if (req.fingerprint && !fingerprint?.path) {
    return NextResponse.json({ error: 'Please upload your completed fingerprint form.' }, { status: 400 })
  }
  if (!rcmp.path) {
    return NextResponse.json({ error: 'Please upload your completed RCMP form.' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const row: ClearanceUpsert = {
    user_id:      user.id,
    ...encryptClearanceFields({
      legal_name_enc:     body.legalName,
      place_of_birth_enc: body.placeOfBirth,
      // The DCN belongs to the fingerprint step; left untouched for RCMP-only clearances
      ...(req.fingerprint ? { dcn_enc: dcn } : {}),
    }),
    form_status:  'review',
    flag_reason:  null,
    // Any resubmission goes back to HR for a fresh review of each form
    rcmp_review:               'pending',
    rcmp_reject_reason:        null,
    fingerprint_review:        'pending',
    fingerprint_reject_reason: null,
    submitted_at: now,
    updated_at:   now,
  }
  if (fingerprint && fingerprint.changed) {
    row.fingerprint_path = fingerprint.path
    row.fingerprint_name = fingerprint.name
  }
  if (rcmp.changed) {
    row.rcmp_path = rcmp.path
    row.rcmp_name = rcmp.name
  }

  const { error } = await admin.from('clearance_info').upsert(row, { onConflict: 'user_id' })
  if (error) {
    console.error(`clearance_info upsert failed (code ${error.code})`)
    return NextResponse.json({ error: 'Failed to save. Please try again.' }, { status: 500 })
  }

  // Delete superseded objects only after the database update has succeeded
  const stale = [
    fingerprint?.changed && existing?.fingerprint_path !== fingerprint.path ? existing?.fingerprint_path : null,
    rcmp.changed && existing?.rcmp_path !== rcmp.path ? existing?.rcmp_path : null,
  ].filter((p): p is string => !!p)
  if (stale.length) {
    const { error: removeError } = await admin.storage.from(CLEARANCE_FILES_BUCKET).remove(stale)
    if (removeError) console.error('Failed to delete a previous clearance file')
  }

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'navy',
    message:      '<strong>New hire</strong> submitted the security clearance form',
    performed_by: user.id,
  })

  if (!existing?.submitted_at) {
    const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    await queueNotification({
      template:  'clearance_submitted',
      to:        hrNotifyEmails(),
      dedupeKey: `clearance_submitted:${user.id}`,
      payload:   { newhireId: user.id, hireName: profile?.full_name ?? '', link: appUrl(`/hr/newhire/${user.id}`) },
    })
  }

  return NextResponse.json({ ok: true })
}
