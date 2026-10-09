import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { esc } from '@/lib/safe-html'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole('payroll')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { id } = await params

  // Verify hire exists and is approved
  const { data: hire } = await admin.from('profiles').select('status, full_name').eq('id', id).single()
  if (!hire || hire.status !== 'approved') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { employeeId } = await request.json()
  if (!employeeId || String(employeeId).trim().length < 1) {
    return NextResponse.json({ error: 'employeeId required' }, { status: 400 })
  }

  const trimmed = String(employeeId).trim()
  if (trimmed.length > 50) {
    return NextResponse.json({ error: 'employeeId too long' }, { status: 400 })
  }

  const now = new Date().toISOString()

  const { error } = await admin
    .from('profiles')
    .update({ employee_id: trimmed, payroll_completed_at: now, updated_at: now })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'green',
    message:      `<strong>Payroll</strong> assigned employee ID <strong>${esc(trimmed)}</strong> — payroll processing complete`,
    performed_by: user.id,
  })

  return NextResponse.json({ ok: true, employeeId: trimmed })
}
