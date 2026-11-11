import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { DocumentReviewBody, isUuid } from '@/lib/review-schemas'
import { firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'
import { recomputeProfileStatus } from '@/lib/hire-status'
import { syncClearancePackage } from '@/lib/clearance-package'
import { DRIVERS_LICENSE_TYPE } from '@/lib/required-documents'
import { tryStartInsurance } from '@/lib/vehicle-server'
import { queueNotification, queueHireApproved } from '@/lib/notify'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const admin = createServiceClient()

  const { id } = await params
  // file_path is deliberately excluded — storage paths never leave the server
  const { data: documents } = await admin
    .from('newhire_documents')
    .select('id, user_id, document_type, document_label, file_name, file_size, expiry_date, form_status, flag_reason, uploaded_at, updated_at, reviewed_at, reviewed_by, sharepoint_filed, sharepoint_filed_at')
    .eq('user_id', id)
    .order('uploaded_at', { ascending: true })

  return NextResponse.json({ documents: documents ?? [] })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = DocumentReviewBody.safeParse(read.data)
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error)
    return NextResponse.json({ error: message, field }, { status: 400 })
  }
  const { documentId, action, reason } = parsed.data

  // Verify document belongs to the specified hire
  const { data: doc } = await admin
    .from('newhire_documents')
    .select('id, user_id, document_type, uploaded_at')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc || doc.user_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin.from('newhire_documents').update({
    form_status: action === 'approve' ? 'approved' : 'rejected',
    flag_reason: action === 'reject' ? reason : null,
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id,
    updated_at:  new Date().toISOString(),
  }).eq('id', documentId)

  if (error) {
    console.error(`document review failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save the review. Please try again.' }, { status: 500 })
  }

  // Documents are one of the 5 onboarding items: refresh the stored status (and payroll queueing)
  const { enteredPayrollQueue } = await recomputeProfileStatus(admin, id)
  if (enteredPayrollQueue) await queueHireApproved(id)
  // Rejected: the hire is told the Documents section needs a fix (once per upload, never the reason)
  if (action === 'reject') {
    await queueNotification({ template: 'item_flagged', hireId: id, payload: { section: 'documents' }, version: `${doc.id}:${doc.uploaded_at}` })
  }
  // An ID document (driver's licence or alternate ID) is part of the clearance package
  await syncClearancePackage(admin, id, user.id)
  // An approved Driver's License may be the last thing Marley's insurance step was waiting for.
  // Safe to call every time: it starts the step at most once.
  if (action === 'approve' && doc.document_type === DRIVERS_LICENSE_TYPE) await tryStartInsurance(admin, id)

  return NextResponse.json({ ok: true })
}
