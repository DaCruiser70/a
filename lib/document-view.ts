import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'

export type DocumentViewResult = {
  url:           string
  label:         string
  document_type: string
}

export async function getDocumentSignedUrl(
  admin:      SupabaseClient<Database>,
  hireId:     string,
  documentId: string,
): Promise<DocumentViewResult | null> {
  const { data: doc } = await admin
    .from('newhire_documents')
    .select('file_path, user_id, document_label, document_type')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc || doc.user_id !== hireId) return null

  const { data: signedData, error } = await admin.storage
    .from('newhire-documents')
    .createSignedUrl(doc.file_path, 60)

  if (error || !signedData?.signedUrl) return null

  return {
    url:           signedData.signedUrl,
    label:         doc.document_label,
    document_type: doc.document_type,
  }
}
