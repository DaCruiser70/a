import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { applyFormStatus } from '@/lib/form-status'
import type { FormStatus } from '@/types'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'payroll') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params

  // Verify hire is approved (payroll only processes approved hires)
  const { data: hire } = await admin.from('profiles').select('status').eq('id', id).single()
  if (!hire || hire.status !== 'approved') return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { formId, status, reason }: { formId: string; status: FormStatus; reason?: string } = await request.json()

  if (!formId) return NextResponse.json({ error: 'formId required' }, { status: 400 })

  const result = await applyFormStatus(admin, id, formId, status, reason, user.id, 'Payroll')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus })

  return NextResponse.json({ ok: true, overallStatus: result.overallStatus })
}
