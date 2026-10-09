import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { applyFormStatus } from '@/lib/form-status'
import type { HireStatus } from '@/types'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

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
