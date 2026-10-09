import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'
import { buildDownloadName, getHireNameParts } from './download-name'

export const VOID_CHEQUE_BUCKET = 'void-cheques'
export const VOID_CHEQUE_EXTS   = ['png', 'jpg', 'jpeg', 'pdf'] as const

/**
 * Looks up void_cheque_path for the given hire and generates a 60-second signed URL.
 * With download: true the URL is served as an attachment with a server-built filename.
 * The raw storage path is never returned or logged — only the signed URL leaves this function.
 * Returns null if no cheque is on file or if signing fails.
 */
export async function getVoidChequeSignedUrl(
  admin:   SupabaseClient<Database>,
  hireId:  string,
  options: { download?: boolean } = {},
): Promise<string | null> {
  const { data: banking } = await admin
    .from('banking_info')
    .select('void_cheque_path')
    .eq('user_id', hireId)
    .maybeSingle()

  if (!banking?.void_cheque_path) return null

  let download: string | undefined
  if (options.download) {
    const { firstName, lastName } = await getHireNameParts(admin, hireId)
    download = buildDownloadName('void-cheque', lastName, firstName, banking.void_cheque_path)
  }

  const { data: signedData, error } = await admin.storage
    .from(VOID_CHEQUE_BUCKET)
    .createSignedUrl(banking.void_cheque_path, 60, download ? { download } : undefined)

  if (error || !signedData) return null

  return signedData.signedUrl
}
