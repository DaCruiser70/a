import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { FormStatusBody, isUuid } from '@/lib/review-schemas'
import { firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'
import { inPayrollQueue } from '@/lib/payroll-access'
import { applyFormStatus } from '@/lib/form-status'

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

  // Verify hire is approved (payroll only processes approved hires)
  const { data: hire } = await admin.from('profiles').select('status, entered_payroll_queue_at').eq('id', id).single()
  if (!inPayrollQueue(hire)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = FormStatusBody.safeParse(read.data)
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error)
    return NextResponse.json({ error: message, field }, { status: 400 })
  }
  const { formId, status } = parsed.data
  const reason = parsed.data.reason ?? undefined
  if (formId === 'clearance') return NextResponse.json({ error: 'Unknown form.' }, { status: 400 })

  const result = await applyFormStatus(admin, id, formId, status, reason, user.id, 'Payroll')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus })

  return NextResponse.json({ ok: true, overallStatus: result.overallStatus })
}
