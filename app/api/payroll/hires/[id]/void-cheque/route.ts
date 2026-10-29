import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { inPayrollQueue } from '@/lib/payroll-access'
import { getVoidChequeSignedUrl } from '@/lib/void-cheque'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('payroll')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const { id } = await params

  // Enforce the same hard boundary as the rest of the payroll portal
  const { data: hire } = await admin.from('profiles').select('status, entered_payroll_queue_at').eq('id', id).single()
  if (!inPayrollQueue(hire)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const download = new URL(request.url).searchParams.get('download') === '1'

  const url = await getVoidChequeSignedUrl(admin, id, { download })
  if (!url) return NextResponse.json({ error: 'No void cheque on file' }, { status: 404 })

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      download ? '<strong>Payroll</strong> downloaded the void cheque' : '<strong>Payroll</strong> viewed the void cheque',
    performed_by: user.id,
  })

  return NextResponse.json({ url })
}
