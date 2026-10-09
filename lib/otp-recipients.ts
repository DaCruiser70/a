import { createServiceClient } from '@/lib/supabase/server'

// Addresses a login code is delivered to. For now, only the account's own address.
// Never returned to the client or logged.
export async function getOtpRecipients(userId: string): Promise<string[]> {
  const { data, error } = await createServiceClient()
    .from('profiles')
    .select('aem_email')
    .eq('id', userId)
    .maybeSingle()

  if (error) {
    console.error(`getOtpRecipients lookup failed (code ${error.code})`)
    return []
  }
  return data?.aem_email ? [data.aem_email] : []
}
