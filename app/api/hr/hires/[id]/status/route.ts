import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { FormStatusBody, isUuid } from '@/lib/review-schemas'
import { firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'
import { applyFormStatus } from '@/lib/form-status'
import { applyClearanceStatus } from '@/lib/clearance-server'
import { syncClearancePackage } from '@/lib/clearance-package'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = FormStatusBody.safeParse(read.data)
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error)
    return NextResponse.json({ error: message, field }, { status: 400 })
  }
  const { formId, status } = parsed.data
  const reason = parsed.data.reason ?? undefined

  // Only form-level changes are accepted. A hire's overall status is never set directly:
  // applyFormStatus recomputes it from the four form statuses with computeHireStatus.

  // Security clearance is tracked separately: it writes only clearance_info and never
  // recomputes the hire's status, progress or payroll queue
  if (formId === 'clearance') {
    const result = await applyClearanceStatus(admin, id, status, reason, user.id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus })
    await syncClearancePackage(admin, id, user.id)
    return NextResponse.json({ ok: true, clearanceStatus: result.status })
  }

  const result = await applyFormStatus(admin, id, formId, status, reason, user.id, 'HR')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus })
  return NextResponse.json({ ok: true, overallStatus: result.overallStatus })
}
