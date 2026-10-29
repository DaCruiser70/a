import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { REGIONS } from '@/lib/regions'

// HR only: each region's active project-management team, so HR can check the lists.
// The lists are edited in SQL for now.
export async function GET() {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const { data, error } = await createServiceClient()
    .from('region_teams')
    .select('id, region, member_name, member_email')
    .eq('active', true)
    .order('member_name', { ascending: true })
    .limit(500)
  if (error) {
    console.error(`[hr/region-teams] list failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not load the region teams.' }, { status: 500 })
  }

  return NextResponse.json({
    regions: REGIONS.map(region => ({
      region,
      members: (data ?? [])
        .filter(m => m.region === region)
        .map(m => ({ id: m.id, name: m.member_name, email: m.member_email })),
    })),
  })
}
