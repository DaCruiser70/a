import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { applyFormStatus } from '@/lib/form-status'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { id } = await params
  const { formId, status, reason } = await request.json()

  // Only form-level changes are accepted. A hire's overall status is never set directly:
  // applyFormStatus recomputes it from the four form statuses with computeHireStatus.
  if (!formId) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const result = await applyFormStatus(admin, id, formId, status, reason, user.id, 'HR')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus })
  return NextResponse.json({ ok: true, overallStatus: result.overallStatus })
}
