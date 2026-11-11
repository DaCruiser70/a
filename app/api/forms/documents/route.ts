import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { recomputeProfileStatus, hasCompanyVehicle } from '@/lib/hire-status'
import { syncClearancePackage } from '@/lib/clearance-package'
import { afterHireFormSaved } from '@/lib/submission-server'
import { FIELD_LIMITS, UPLOAD_EXTENSIONS, UPLOAD_MAX_BYTES, displayFileName } from '@/lib/field-limits'
import { zText, zIsoDate, firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'

const BUCKET = 'newhire-documents'

// Every document type the Documents page offers. The required ones and their rules live in
// lib/required-documents.ts; the rest are optional.
const DOCUMENT_TYPES = [
  'td1_federal', 'td1_provincial', 'drivers_license', 'alternative_id', 'proof_of_insurance',
  'cpic_background_check', 'work_permit', 'trade_license', 'safety_certification',
] as const
const MULTI_TYPES: readonly string[] = ['trade_license', 'safety_certification']
const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png']

// Only what the page sends. Completeness is never taken from the browser: it is worked out from the
// stored documents after the save (afterHireFormSaved). file_size from the browser is ignored; the
// real size comes from storage.
const BodySchema = z.strictObject({
  document_type:  z.enum(DOCUMENT_TYPES, { error: 'Unknown document type.' }),
  document_label: zText('Document name', FIELD_LIMITS.shortText),
  file_path:      z.string().min(1).max(200),
  file_name:      z.string().max(1000),
  file_size:      z.number().int().nonnegative().optional(),
  expiry_date:    zIsoDate.nullable().optional(),
})

export async function GET() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()
  // file_path is deliberately excluded — storage paths never leave the server
  const [{ data: documents }, { data: equipment }] = await Promise.all([
    admin
      .from('newhire_documents')
      .select('id, user_id, document_type, document_label, file_name, file_size, expiry_date, form_status, flag_reason, uploaded_at, updated_at, reviewed_at, reviewed_by, sharepoint_filed, sharepoint_filed_at')
      .eq('user_id', user.id)
      .order('uploaded_at', { ascending: false }),
    admin.from('equipment_provisioning').select('items').eq('user_id', user.id).maybeSingle(),
  ])

  // company_vehicle: the Driver's License is then the required ID (lib/required-documents.ts)
  return NextResponse.json({ documents: documents ?? [], company_vehicle: hasCompanyVehicle(equipment?.items) })
}

export async function POST(request: Request) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('forms:documents', user.id), 40, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many uploads. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = BodySchema.safeParse(read.data)
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error)
    return NextResponse.json({ error: message, field }, { status: 400 })
  }
  const { document_type, document_label, file_path, expiry_date } = parsed.data
  const file_name = displayFileName(parsed.data.file_name, `${document_type}.pdf`)

  // The path must be exactly this hire's folder for this type: {user}/{type}/{timestamp}.{pdf|jpg|jpeg|png}
  const exts = UPLOAD_EXTENSIONS.join('|')
  const pathPattern = new RegExp(`^${user.id}/${document_type}/\\d{10,16}\\.(${exts})$`, 'i')
  if (!pathPattern.test(file_path)) {
    return NextResponse.json({ error: 'Only PDF, JPG or PNG files can be uploaded. Please choose the file again.' }, { status: 400 })
  }

  const admin = createServiceClient()

  // The file must really be in storage; its size and type come from storage, not the browser
  const folder = `${user.id}/${document_type}`
  const objectName = file_path.slice(folder.length + 1)
  const { data: listed, error: listError } = await admin.storage.from(BUCKET).list(folder, { search: objectName })
  const object = listed?.find(o => o.name === objectName)
  if (listError || !object) {
    return NextResponse.json({ error: 'We could not find your upload. Please upload the file again.' }, { status: 400 })
  }
  const size = typeof object.metadata?.size === 'number' ? object.metadata.size : null
  const mime = typeof object.metadata?.mimetype === 'string' ? object.metadata.mimetype : null
  if ((size !== null && size > UPLOAD_MAX_BYTES) || (mime !== null && !ALLOWED_MIME.includes(mime))) {
    await admin.storage.from(BUCKET).remove([file_path])
    return NextResponse.json({
      error: size !== null && size > UPLOAD_MAX_BYTES ? 'File is too large. Maximum size is 10 MB.' : 'Only PDF, JPG or PNG files can be uploaded.',
    }, { status: 400 })
  }

  if (MULTI_TYPES.includes(document_type)) {
    const { error } = await admin.from('newhire_documents').insert({
      user_id:       user.id,
      document_type,
      document_label,
      file_path,
      file_name,
      file_size:     size,
      expiry_date:   expiry_date ?? null,
      form_status:   'review',
      flag_reason:   null,
      reviewed_at:   null,
      reviewed_by:   null,
      sharepoint_filed:    null,
      sharepoint_filed_at: null,
    })
    if (error) {
      console.error(`newhire_documents insert failed (code ${error.code})`)
      return NextResponse.json({ error: 'Failed to save document. Please try again.' }, { status: 500 })
    }
  } else {
    // One row per slot: an upload replaces the earlier file (unless HR already approved it)
    const { data: existing } = await admin
      .from('newhire_documents')
      .select('id, form_status')
      .eq('user_id', user.id)
      .eq('document_type', document_type)
      .maybeSingle()

    if (existing?.form_status === 'approved') {
      await admin.storage.from(BUCKET).remove([file_path])
      return NextResponse.json({ error: 'Document already approved and cannot be replaced.' }, { status: 409 })
    }

    const { error } = existing
      ? await admin.from('newhire_documents').update({
          document_label,
          file_path,
          file_name,
          file_size:   size,
          expiry_date: expiry_date ?? null,
          form_status: 'review',
          flag_reason: null,
          updated_at:  new Date().toISOString(),
        }).eq('id', existing.id)
      : await admin.from('newhire_documents').insert({
          user_id:       user.id,
          document_type,
          document_label,
          file_path,
          file_name,
          file_size:     size,
          expiry_date:   expiry_date ?? null,
          form_status:   'review',
          flag_reason:   null,
          reviewed_at:   null,
          reviewed_by:   null,
          sharepoint_filed:    null,
          sharepoint_filed_at: null,
        })
    if (error) {
      console.error(`newhire_documents save failed (code ${error.code})`)
      return NextResponse.json({ error: 'Failed to save document. Please try again.' }, { status: 500 })
    }
  }

  // Documents are one of the 5 onboarding items: refresh the stored status (and payroll queueing)
  await recomputeProfileStatus(admin, user.id)
  // An ID document (driver's licence or alternate ID) is part of the clearance package
  await syncClearancePackage(admin, user.id, user.id)

  // Whether every required item is now sent, decided from the STORED documents and forms. The
  // page only uses this to offer the "what happens next" link; it never redirects on an upload.
  const { complete } = await afterHireFormSaved(admin, user.id)
  return NextResponse.json({ ok: true, complete })
}
