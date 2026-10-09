import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole, ROLES } from '@/lib/roles'
import { portalsFor } from '@/lib/portals'

// The signed-in user's display name, roles and the portals they may open
export async function GET() {
  const auth = await requireRole(...ROLES)
  if (auth instanceof NextResponse) return auth
  const { user, roles } = auth

  const { data: profile, error } = await createServiceClient()
    .from('profiles')
    .select('full_name, preferred_name')
    .eq('id', user.id)
    .maybeSingle()
  if (error) console.error(`[me] profile lookup failed (code ${error.code})`)

  return NextResponse.json({
    name:    profile?.preferred_name || profile?.full_name || '',
    roles,
    portals: portalsFor(roles).map(p => ({ label: p.label, href: p.href })),
  })
}
