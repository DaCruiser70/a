import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'
import { buildDownloadName, getHireNameParts } from './download-name'

export type DocumentViewResult = {
  url:           string
  label:         string
  document_type: string
}

// Generates a 60-second signed URL for one of the hire's documents.
// With download: true the URL is served as an attachment with a server-built filename.
export async function getDocumentSignedUrl(
  admin:      SupabaseClient<Database>,
  hireId:     string,
  documentId: string,
  options:    { download?: boolean } = {},
): Promise<DocumentViewResult | null> {
  const { data: doc } = await admin
    .from('newhire_documents')
    .select('file_path, user_id, document_label, document_type')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc || doc.user_id !== hireId) return null

  let download: string | undefined
  if (options.download) {
    const { firstName, lastName } = await getHireNameParts(admin, hireId)
    download = buildDownloadName(doc.document_type, lastName, firstName, doc.file_path)
  }

  const { data: signedData, error } = await admin.storage
    .from('newhire-documents')
    .createSignedUrl(doc.file_path, 60, download ? { download } : undefined)

  if (error || !signedData?.signedUrl) return null

  return {
    url:           signedData.signedUrl,
    label:         doc.document_label,
    document_type: doc.document_type,
  }
}
