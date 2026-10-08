import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { recomputeProfileStatus } from '@/lib/hire-status'

export async function GET() {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (caller?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'newhire')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (profiles ?? []).map(p => p.id)

  await Promise.all(ids.map(id => recomputeProfileStatus(admin, id)))

  return NextResponse.json({ ok: true, updated: ids.length })
}
