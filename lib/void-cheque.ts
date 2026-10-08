import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'

/**
 * Looks up void_cheque_path for the given hire and generates a 60-second signed URL.
 * The raw storage path is never returned or logged — only the signed URL leaves this function.
 * Returns null if no cheque is on file or if signing fails.
 */
export async function getVoidChequeSignedUrl(
  admin:  SupabaseClient<Database>,
  hireId: string,
): Promise<string | null> {
  const { data: banking } = await admin
    .from('banking_info')
    .select('void_cheque_path')
    .eq('user_id', hireId)
    .maybeSingle()

  if (!banking?.void_cheque_path) return null

  const { data: signedData, error } = await admin.storage
    .from('void-cheques')
    .createSignedUrl(banking.void_cheque_path, 60)

  if (error || !signedData) return null

  return signedData.signedUrl
}
