import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CLEARANCE_ID_DOC_TYPES } from '@/lib/clearance'
import { getDocumentSignedUrl } from '@/lib/document-view'
import { reviewerGate, auditReviewer, NOT_FOUND } from '@/lib/clearance-review-server'

const QuerySchema = z.strictObject({ download: z.enum(['1']).optional() })

// 60-second URL for the hire's ID document (driver's licence or alternate ID) in a package the
// reviewer can see. Any other document type is a 404. Audited.
export async function GET(request: Request, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params
  if (!z.uuid().safeParse(docId).success) return NOT_FOUND()
  const parsed = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const gate = await reviewerGate(id, 'file', 120)
  if (gate instanceof NextResponse) return gate
  const { admin, hireId, userId } = gate

  const { data: doc } = await admin
    .from('newhire_documents')
    .select('document_type, form_status')
    .eq('id', docId).eq('user_id', hireId).maybeSingle()
  if (!doc || !(CLEARANCE_ID_DOC_TYPES as readonly string[]).includes(doc.document_type) || doc.form_status === 'rejected') return NOT_FOUND()

  const download = parsed.data.download === '1'
  const result = await getDocumentSignedUrl(admin, hireId, docId, { download })
  if (!result) return NOT_FOUND()

  await auditReviewer(admin, hireId, userId, `${download ? 'downloaded' : 'viewed'} the ID document for the clearance package`)
  return NextResponse.json({ url: result.url }, { headers: { 'Cache-Control': 'no-store' } })
}
