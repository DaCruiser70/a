import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { recomputeProfileStatus } from '@/lib/hire-status'

export async function GET() {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const admin = createServiceClient()

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'newhire')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (profiles ?? []).map(p => p.id)

  await Promise.all(ids.map(id => recomputeProfileStatus(admin, id)))

  return NextResponse.json({ ok: true, updated: ids.length })
}
