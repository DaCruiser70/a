import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'payroll') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, position, status, start_date, entered_payroll_queue_at, employee_id, payroll_completed_at, created_at')
    .eq('role', 'newhire')
    .eq('status', 'approved')
    .order('entered_payroll_queue_at', { ascending: true })

  return NextResponse.json({ hires: profiles ?? [] })
}
