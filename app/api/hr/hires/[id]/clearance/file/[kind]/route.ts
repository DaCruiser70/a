import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { CLEARANCE_FILES_BUCKET, isClearanceKind, fileExt } from '@/lib/clearance'
import {
  loadClearanceRequirements, decryptClearanceField, signedClearanceUrl, clearanceDownloadName,
} from '@/lib/clearance-server'

const QuerySchema = z.strictObject({ download: z.enum(['1']).optional() })

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })

const PREFIX = { fingerprint: 'Fingerprint-form', rcmp: 'RCMP-form' } as const

// 60-second URL for one of the hire's clearance files, audited. kind is checked against the fixed
// list and the path is read from clearance_info. The RCMP spreadsheet is always a download, with a
// server-built name like "RCMP-form-Jane-Doe.xlsx".
export async function GET(request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const { id, kind } = await params
  if (!z.uuid().safeParse(id).success || !isClearanceKind(kind)) return NOT_FOUND()

  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const admin = createServiceClient()
  const req = await loadClearanceRequirements(admin, id)
  if (!req.required) return NOT_FOUND()

  const { data: row } = await admin
    .from('clearance_info')
    .select('fingerprint_path, rcmp_path, legal_name_enc, place_of_birth_enc, dcn_enc')
    .eq('user_id', id)
    .maybeSingle()
  const path = kind === 'fingerprint' ? row?.fingerprint_path : row?.rcmp_path
  if (!path) return NOT_FOUND()

  const ext      = fileExt(path)
  const download = parsed.data.download === '1' || ext === 'xlsx'
  const name     = download ? clearanceDownloadName(PREFIX[kind], decryptClearanceField(row, 'legal_name_enc'), ext) : undefined

  const url = await signedClearanceUrl(admin, CLEARANCE_FILES_BUCKET, path, name)
  if (!url) return NOT_FOUND()

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      `<strong>HR</strong> ${download ? 'downloaded' : 'viewed'} the clearance ${kind === 'fingerprint' ? 'fingerprint form' : 'RCMP form'}`,
    performed_by: user.id,
  })

  return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
}
