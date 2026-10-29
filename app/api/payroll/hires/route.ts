import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { PAYROLL_QUEUE_FILTER } from '@/lib/payroll-access'

export async function GET() {
  const auth = await requireRole('payroll')
  if (auth instanceof NextResponse) return auth

  const admin = createServiceClient()

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, position, status, start_date, entered_payroll_queue_at, employee_id, payroll_completed_at, created_at')
    .eq('role', 'newhire')
    // Fully approved hires, plus any hire already in the payroll queue (lib/payroll-access.ts)
    .or(PAYROLL_QUEUE_FILTER)
    .order('entered_payroll_queue_at', { ascending: true })

  return NextResponse.json({ hires: profiles ?? [] })
}
