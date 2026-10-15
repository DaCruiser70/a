import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { CLEARANCE_FILES_BUCKET, isClearanceKind, fileExt } from '@/lib/clearance'
import { loadClearanceRequirements, signedClearanceUrl } from '@/lib/clearance-server'

const NO_STORE = { 'Cache-Control': 'no-store' }

// 60-second URL for the hire's own uploaded file. The path is read from their clearance_info row;
// kind is checked against the fixed list. A spreadsheet is always served as a download.
export async function GET(_request: Request, { params }: { params: Promise<{ kind: string }> }) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { kind } = await params
  if (!isClearanceKind(kind)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })

  const admin = createServiceClient()
  const req = await loadClearanceRequirements(admin, user.id)
  if (!req.required) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })

  const { data: row } = await admin
    .from('clearance_info')
    .select('fingerprint_path, rcmp_path')
    .eq('user_id', user.id)
    .maybeSingle()
  const path = kind === 'fingerprint' ? row?.fingerprint_path : row?.rcmp_path
  if (!path) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })

  const ext = fileExt(path)
  const url = await signedClearanceUrl(admin, CLEARANCE_FILES_BUCKET, path, ext === 'xlsx' ? `${kind}-form.xlsx` : undefined)
  if (!url) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })

  return NextResponse.json({ url }, { headers: NO_STORE })
}
