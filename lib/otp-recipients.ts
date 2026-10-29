import { createServiceClient } from '@/lib/supabase/server'
import { loadAccountMember } from '@/lib/pm-server'

// Addresses a login code is delivered to. Never returned to the client or logged.
//   • Every account: its own address.
//   • A shared regional project-management account: the chosen team member's real address
//     (only if that member is active and in the account's region; otherwise nobody).
export async function getOtpRecipients(userId: string, memberId?: string | null): Promise<string[]> {
  const admin = createServiceClient()

  if (memberId) {
    const member = await loadAccountMember(admin, userId, memberId)
    return member ? [member.member_email] : []
  }

  const { data, error } = await admin
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
