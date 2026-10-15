import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { getClearanceRequirements, computeClearanceStatus } from '@/lib/clearance'
import { loadSubmission } from '@/lib/submission-server'

// The hire's checklist state: each form's status, the documents item, what has been sent to HR,
// and security clearance (only when unlocked; never part of formStatuses or any progress count).
export async function GET() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const [
    { data: profile },
    { statuses, submission },
    { data: plan },
    { data: clearance },
  ] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', user.id).single(),
    loadSubmission(admin, user.id),
    admin.from('manager_plans').select('status, clearance_type').eq('newhire_id', user.id).maybeSingle(),
    admin.from('clearance_info').select('form_status').eq('user_id', user.id).maybeSingle(),
  ])

  const clearanceRequired = getClearanceRequirements(plan).required

  return NextResponse.json({
    name: profile?.full_name ?? '',
    formStatuses: {
      personal: statuses.personal,
      banking:  statuses.banking,
      sin:      statuses.sin,
      policy:   statuses.policy,
    },
    documentsStatus: statuses.documents,
    submission: { sent: submission.sent, total: submission.total, complete: submission.complete },
    clearance: clearanceRequired
      ? { required: true, status: computeClearanceStatus(clearance?.form_status) }
      : { required: false, status: null },
  })
}
