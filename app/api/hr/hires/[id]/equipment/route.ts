import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { items }: { items: Record<string, boolean> } = await request.json()

  const { error } = await admin
    .from('equipment_provisioning')
    .upsert({ user_id: id, items, saved_by: user.id, saved_at: new Date().toISOString() }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const issuedCount = Object.values(items).filter(Boolean).length
  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      `<strong>HR</strong> saved equipment provisioning — ${issuedCount} items issued`,
    performed_by: user.id,
  })

  return NextResponse.json({ ok: true })
}
