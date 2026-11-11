import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { DocumentReviewBody, isUuid } from '@/lib/review-schemas'
import { firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'
import { recomputeProfileStatus } from '@/lib/hire-status'
import { esc } from '@/lib/safe-html'
import { queueNotification, queueHireApproved } from '@/lib/notify'

const ALLOWED_DOC_TYPES = new Set(['td1_federal', 'td1_provincial', 'direct_deposit'])

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('payroll')
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

  // Verify document belongs to this hire and is a payroll-visible type
  const { data: doc } = await admin
    .from('newhire_documents')
    .select('id, user_id, document_type, document_label, uploaded_at')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc || doc.user_id !== id) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!ALLOWED_DOC_TYPES.has(doc.document_type)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date().toISOString()
  const { error } = await admin.from('newhire_documents').update({
    form_status: action === 'approve' ? 'approved' : 'rejected',
    flag_reason: action === 'reject' ? reason : null,
    reviewed_at: now,
    reviewed_by: user.id,
    updated_at:  now,
  }).eq('id', documentId)

  if (error) {
    console.error(`payroll document review failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }

  const actionType = action === 'approve' ? 'green' : 'red'
  const reasonNote = action === 'reject' && reason ? ` — ${esc(reason)}` : ''
  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  actionType,
    message:      `<strong>Payroll</strong> marked ${esc(doc.document_label)} as <strong>${action === 'approve' ? 'approved' : 'rejected'}</strong>${reasonNote}`,
    performed_by: user.id,
  })

  // Documents are one of the 5 onboarding items: refresh the stored status (and payroll queueing)
  // (a hire already in the payroll queue stays visible to payroll: lib/payroll-access.ts)
  const { enteredPayrollQueue } = await recomputeProfileStatus(admin, id)
  if (enteredPayrollQueue) await queueHireApproved(id)
  // Rejected: the hire is told the Documents section needs a fix (once per upload, never the reason)
  if (action === 'reject') {
    await queueNotification({ template: 'item_flagged', hireId: id, payload: { section: 'documents' }, version: `${doc.id}:${doc.uploaded_at}` })
  }

  return NextResponse.json({ ok: true })
}
