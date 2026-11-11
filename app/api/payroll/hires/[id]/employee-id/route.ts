import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { z } from 'zod'
import { FIELD_LIMITS } from '@/lib/field-limits'
import { zText, firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'
import { isUuid } from '@/lib/review-schemas'

const EmployeeIdBody = z.strictObject({
  employeeId: zText('Employee ID', FIELD_LIMITS.employeeId, {
    pattern: /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/,
    patternMessage: 'Employee ID can only contain letters, digits, spaces, periods, dashes, slashes and underscores.',
  }),
})
import { inPayrollQueue } from '@/lib/payroll-access'
import { esc } from '@/lib/safe-html'
import { queueNotification } from '@/lib/notify'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('payroll')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Verify hire exists and is approved
  const { data: hire } = await admin.from('profiles').select('status, full_name, entered_payroll_queue_at').eq('id', id).single()
  if (!inPayrollQueue(hire)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = EmployeeIdBody.safeParse(read.data)
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error)
    return NextResponse.json({ error: message, field }, { status: 400 })
  }
  const trimmed = parsed.data.employeeId

  const now = new Date().toISOString()

  const { error } = await admin
    .from('profiles')
    .update({ employee_id: trimmed, payroll_completed_at: now, updated_at: now })
    .eq('id', id)

  if (error) {
    console.error(`employee id update failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'green',
    message:      `<strong>Payroll</strong> assigned employee ID <strong>${esc(trimmed)}</strong> — payroll processing complete`,
    performed_by: user.id,
  })

  // HR is told once per hire (a corrected employee ID later sends nothing)
  await queueNotification({ template: 'payroll_done', hireId: id, payload: {} })

  return NextResponse.json({ ok: true, employeeId: trimmed })
}
