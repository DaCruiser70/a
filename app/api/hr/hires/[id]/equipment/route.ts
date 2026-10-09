import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

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
