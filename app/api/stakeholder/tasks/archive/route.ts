import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'

// Hides this stakeholder's confirmed tasks for newhires beyond the 5 most recently
// completed (fully confirmed). Never deletes rows; only sets hidden_from_stakeholder = true.
// Only operates on rows where assigned_to = current user.
export async function POST() {
  const auth = await requireRole('stakeholder')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  // Fetch all tasks for this stakeholder (including already-hidden, to get the full picture)
  const { data: allTasks } = await admin
    .from('stakeholder_tasks')
    .select('id, newhire_id, status, confirmed_at')
    .eq('assigned_to', user.id)

  if (!allTasks || allTasks.length === 0) return NextResponse.json({ ok: true })

  // Group by newhire and determine whether all tasks for that hire are confirmed
  type HireGroup = { ids: string[]; maxConfirmedAt: string; allConfirmed: boolean }
  const byHire: Record<string, HireGroup> = {}

  for (const t of allTasks) {
    if (!byHire[t.newhire_id]) {
      byHire[t.newhire_id] = { ids: [], maxConfirmedAt: '', allConfirmed: true }
    }
    byHire[t.newhire_id].ids.push(t.id)
    if (t.status !== 'confirmed') byHire[t.newhire_id].allConfirmed = false
    if (t.confirmed_at && t.confirmed_at > byHire[t.newhire_id].maxConfirmedAt) {
      byHire[t.newhire_id].maxConfirmedAt = t.confirmed_at
    }
  }

  // Only fully completed hires are eligible for archiving
  const completedHires = Object.values(byHire)
    .filter(g => g.allConfirmed)
    .sort((a, b) => b.maxConfirmedAt.localeCompare(a.maxConfirmedAt))

  // Keep the 5 most recently completed; hide all tasks for the rest
  const toHide = completedHires.slice(5).flatMap(g => g.ids)
  if (toHide.length === 0) return NextResponse.json({ ok: true })

  await admin
    .from('stakeholder_tasks')
    .update({ hidden_from_stakeholder: true })
    .in('id', toHide)
    .eq('assigned_to', user.id)

  return NextResponse.json({ ok: true })
}
