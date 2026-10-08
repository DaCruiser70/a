import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role, full_name').eq('id', user.id).single()
  if (callerProfile?.role !== 'payroll') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
    message:      `<strong>Payroll</strong> assigned employee ID <strong>${trimmed}</strong> — payroll processing complete`,
    performed_by: user.id,
  })

  return NextResponse.json({ ok: true, employeeId: trimmed })
}
