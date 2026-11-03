import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { getDocumentSignedUrl } from '@/lib/document-view'
import { DRIVERS_LICENSE_TYPE } from '@/lib/required-documents'
import { INSURANCE_TASK_KEY } from '@/lib/vehicle'
import { vehicleStepAccounts } from '@/lib/vehicle-server'

// Marley's view of the hire's Driver's License for the vehicle insurance step. A 60-second signed
// URL, and ONLY when all of these hold, checked here on every call:
//   - the signed-in stakeholder is the insurance account (VEHICLE_STEP_EMAILS.marley)
//   - this hire's vehicle request is at her step ('marley') and her task is open and visible
//   - the document is this hire's Driver's License and HR has approved it
// No document id is accepted, so no other document of the hire can be reached through here.
// Every view and download is audited (hire and document type only: no file name or contents).

const NO_STORE  = { 'Cache-Control': 'no-store' }
const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE })

const QuerySchema = z.strictObject({ download: z.enum(['0', '1']).optional() })

export async function GET(request: Request, { params }: { params: Promise<{ hireId: string }> }) {
  const auth = await requireRole('stakeholder')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('stakeholder:vehicle-license', user.id), 30, 10 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { hireId } = await params
  if (!z.uuid().safeParse(hireId).success) return NOT_FOUND()
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400, headers: NO_STORE })
  const download = query.data.download === '1'

  const admin = createServiceClient()
  const [accounts, { data: row }, { data: task }, { data: doc }] = await Promise.all([
    vehicleStepAccounts(admin),
    admin.from('vehicle_requests').select('step').eq('newhire_id', hireId).maybeSingle(),
    admin.from('stakeholder_tasks').select('id')
      .eq('newhire_id', hireId).eq('assigned_to', user.id).eq('task_key', INSURANCE_TASK_KEY)
      .eq('status', 'pending').eq('hidden_from_stakeholder', false).maybeSingle(),
    admin.from('newhire_documents').select('id')
      .eq('user_id', hireId).eq('document_type', DRIVERS_LICENSE_TYPE).eq('form_status', 'approved').maybeSingle(),
  ])

  // Her account, her step, her open task, an approved licence: anything else is the same 404
  if (accounts.marley?.id !== user.id || row?.step !== 'marley' || !task || !doc) return NOT_FOUND()

  const result = await getDocumentSignedUrl(admin, hireId, doc.id, { download })
  if (!result || result.document_type !== DRIVERS_LICENSE_TYPE) return NOT_FOUND()

  await admin.from('audit_log').insert({
    user_id:      hireId,
    action_type:  'amber',
    message:      `<strong>Stakeholder</strong> (vehicle insurance) ${download ? 'downloaded' : 'viewed'} the Driver’s License`,
    performed_by: user.id,
  })

  return NextResponse.json({ url: result.url }, { headers: NO_STORE })
}
