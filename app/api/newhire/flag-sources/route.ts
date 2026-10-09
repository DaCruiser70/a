import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'

// Returns which actor ('HR' | 'Payroll') most recently flagged each form for this new hire.
// Used by individual form pages to show "Flagged by HR / Payroll" in the Action Required banner.
export async function GET() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  // Fetch recent red (flag) audit entries for this user
  const { data: entries } = await admin
    .from('audit_log')
    .select('message, created_at')
    .eq('user_id', user.id)
    .eq('action_type', 'red')
    .order('created_at', { ascending: false })
    .limit(30)

  const formIds = ['personal', 'banking', 'sin', 'policy', 'documents']
  const sources: Record<string, string | null> = {}

  for (const formId of formIds) {
    // Match the most recent red entry that flagged this specific form
    const entry = (entries ?? []).find(e =>
      e.message.includes(`${formId} form as`) || e.message.includes(`${formId} document`)
    )
    if (entry) {
      sources[formId] = entry.message.includes('<strong>Payroll</strong>') ? 'Payroll' : 'HR'
    } else {
      sources[formId] = null
    }
  }

  return NextResponse.json({ sources })
}
