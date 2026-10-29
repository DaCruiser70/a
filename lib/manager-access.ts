import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'
import { PLAN_COLUMNS } from '@/lib/manager-plan'

// A manager account owns the plans whose manager_id is a managers row linked to it (managers.user_id)
export async function managerIdsFor(admin: SupabaseClient<Database>, userId: string): Promise<string[]> {
  const { data, error } = await admin.from('managers').select('id').eq('user_id', userId)
  if (error) {
    console.error(`[manager-access] lookup failed (code ${error.code})`)
    return []
  }
  return (data ?? []).map(m => m.id)
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The plan for this hire if, and only if, it belongs to this manager. A missing plan, a malformed id
// and someone else's plan all look the same to the caller.
export async function ownedPlan(admin: SupabaseClient<Database>, userId: string, newhireId: string) {
  if (!UUID_RE.test(newhireId)) return null
  const ids = await managerIdsFor(admin, userId)
  if (ids.length === 0) return null

  const { data, error } = await admin
    .from('manager_plans')
    .select(PLAN_COLUMNS)
    .eq('newhire_id', newhireId)
    .in('manager_id', ids)
    .maybeSingle()
  if (error) {
    console.error(`[manager-access] plan lookup failed (code ${error.code})`)
    return null
  }
  return data
}
