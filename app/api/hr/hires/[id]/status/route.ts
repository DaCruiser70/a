import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { FormStatus, HireStatus } from '@/types'

const FORM_TABLES: Record<string, string> = {
  personal: 'personal_info',
  banking:  'banking_info',
  sin:      'sin_info',
  policy:   'policy_acknowledgements',
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { formId, status, reason }: { formId?: string; status: FormStatus | HireStatus; reason?: string } = await request.json()

  if (formId) {
    const table = FORM_TABLES[formId]
    if (!table) return NextResponse.json({ error: 'Unknown form' }, { status: 400 })

    await admin
      .from(table as 'personal_info')
      .update({
        form_status:  status as FormStatus,
        flag_reason:  status === 'flagged' ? (reason ?? null) : null,
        updated_at:   new Date().toISOString(),
      } as never)
      .eq('user_id', id)

    // Recompute overall profile status
    const [pi, bi, si, po] = await Promise.all([
      admin.from('personal_info').select('form_status').eq('user_id', id).maybeSingle(),
      admin.from('banking_info').select('form_status').eq('user_id', id).maybeSingle(),
      admin.from('sin_info').select('form_status').eq('user_id', id).maybeSingle(),
      admin.from('policy_acknowledgements').select('form_status').eq('user_id', id).maybeSingle(),
    ])

    const statuses = [pi.data?.form_status, bi.data?.form_status, si.data?.form_status, po.data?.form_status]
    let overallStatus: HireStatus = 'needs-review'
    if (statuses.some(s => s === 'flagged'))          overallStatus = 'flagged'
    else if (statuses.every(s => s === 'approved'))   overallStatus = 'approved'
    else if (statuses.every(s => s === 'pending'))    overallStatus = 'not-started'

    await admin
      .from('profiles')
      .update({ status: overallStatus, updated_at: new Date().toISOString() })
      .eq('id', id)

    const actionType = status === 'approved' ? 'green' : status === 'flagged' ? 'red' : 'amber'
    const reasonNote = status === 'flagged' && reason ? ` — <em>${reason}</em>` : ''
    await admin.from('audit_log').insert({
      user_id:      id,
      action_type:  actionType,
      message:      `<strong>HR</strong> marked ${formId} form as <strong>${status}</strong>${reasonNote}`,
      performed_by: user.id,
    })

    return NextResponse.json({ ok: true, overallStatus })
  }

  // Update overall hire status directly
  await admin
    .from('profiles')
    .update({ status: status as HireStatus, updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
