import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { CLEARANCE_TEMPLATES_BUCKET, CLEARANCE_TEMPLATE_FILES, isClearanceKind } from '@/lib/clearance'
import { loadClearanceRequirements, signedClearanceUrl } from '@/lib/clearance-server'

const NO_STORE = { 'Cache-Control': 'no-store' }

// 60-second download URL for a blank form. kind is checked against the fixed list and the
// object name is a constant, so nothing from the request reaches a storage path.
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { kind } = await params
  if (!isClearanceKind(kind)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })

  const admin = createServiceClient()
  const req = await loadClearanceRequirements(admin, user.id)
  if (!req.required || (kind === 'fingerprint' && !req.fingerprint)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const file = CLEARANCE_TEMPLATE_FILES[kind]
  const url  = await signedClearanceUrl(admin, CLEARANCE_TEMPLATES_BUCKET, file, file)
  // Missing template: the page shows "Form coming soon from HR"
  if (!url) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })

  return NextResponse.json({ url }, { headers: NO_STORE })
}
