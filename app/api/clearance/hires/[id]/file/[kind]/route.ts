import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CLEARANCE_FILES_BUCKET, isClearanceKind, fileExt } from '@/lib/clearance'
import { decryptClearanceField, signedClearanceUrl, clearanceDownloadName } from '@/lib/clearance-server'
import { reviewerGate, auditReviewer, NOT_FOUND } from '@/lib/clearance-review-server'

const QuerySchema = z.strictObject({ download: z.enum(['1']).optional() })
const PREFIX = { fingerprint: 'Fingerprint-form', rcmp: 'RCMP-form' } as const
const LABEL  = { fingerprint: 'PSPC fingerprint form', rcmp: 'RCMP form' } as const

// 60-second URL for the RCMP or PSPC fingerprint form in a package the reviewer can see. Audited.
export async function GET(request: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params
  if (!isClearanceKind(kind)) return NOT_FOUND()
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const gate = await reviewerGate(id, 'file', 120)
  if (gate instanceof NextResponse) return gate
  const { admin, hireId, userId } = gate

  const { data: row } = await admin
    .from('clearance_info')
    .select('fingerprint_path, rcmp_path, legal_name_enc, place_of_birth_enc, dcn_enc')
    .eq('user_id', hireId).maybeSingle()
  const path = kind === 'fingerprint' ? row?.fingerprint_path : row?.rcmp_path
  if (!path) return NOT_FOUND()

  const ext      = fileExt(path)
  const download = parsed.data.download === '1' || ext === 'xlsx'
  const name     = download ? clearanceDownloadName(PREFIX[kind], decryptClearanceField(row, 'legal_name_enc'), ext) : undefined
  const url = await signedClearanceUrl(admin, CLEARANCE_FILES_BUCKET, path, name)
  if (!url) return NOT_FOUND()

  await auditReviewer(admin, hireId, userId, `${download ? 'downloaded' : 'viewed'} the clearance ${LABEL[kind]}`)
  return NextResponse.json({ url }, { headers: { 'Cache-Control': 'no-store' } })
}
