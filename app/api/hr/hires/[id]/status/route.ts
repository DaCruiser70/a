import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { applyFormStatus } from '@/lib/form-status'
import type { HireStatus } from '@/types'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { formId, status, reason } = await request.json()

  if (formId) {
    const result = await applyFormStatus(admin, id, formId, status, reason, user.id, 'HR')
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus })
    return NextResponse.json({ ok: true, overallStatus: result.overallStatus })
  }

  // Direct overall status override (no form transition logic)
  await admin
    .from('profiles')
    .update({ status: status as HireStatus, updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
