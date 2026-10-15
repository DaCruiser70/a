import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { loadHrClearanceView } from '@/lib/clearance-server'

// HR only. Non-sensitive fields, has_* flags, the legal name and the status. Place of birth and
// DCN are only ever returned one at a time through the audited reveal route.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const admin = createServiceClient()
  const { data: hire } = await admin.from('profiles').select('id').eq('id', id).maybeSingle()
  if (!hire) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(await loadHrClearanceView(admin, id))
}
