import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, FormStatus } from '@/types'
import { computeDocumentStatus, computeSubmission, type RequiredItem, type Submission } from '@/lib/submission'
import { queueNotification, hrNotifyEmails, appUrl } from '@/lib/notify'

type Admin = SupabaseClient<Database>

// Reads the hire's stored statuses and derives what has been sent to HR. Server only.
export async function loadSubmission(admin: Admin, userId: string): Promise<{
  statuses:   Record<RequiredItem, FormStatus>
  submission: Submission
}> {
  const [pi, bi, si, po, docs] = await Promise.all([
    admin.from('personal_info').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('banking_info').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('sin_info').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('policy_acknowledgements').select('form_status').eq('user_id', userId).maybeSingle(),
    admin.from('newhire_documents').select('document_type, form_status').eq('user_id', userId),
  ])
  const statuses: Record<RequiredItem, FormStatus> = {
    personal:  pi.data?.form_status ?? 'pending',
    banking:   bi.data?.form_status ?? 'pending',
    sin:       si.data?.form_status ?? 'pending',
    policy:    po.data?.form_status ?? 'pending',
    documents: computeDocumentStatus(docs.data ?? []),
  }
  return { statuses, submission: computeSubmission(statuses, docs.data ?? []) }
}

// Call after any required form or document is saved. When that save completes the set, it queues
// one onboarding_complete notice to HR and writes one audit entry. Idempotent: the notice's dedupe
// key means a second save, or a resave after a flag, adds nothing. Never fails the calling request.
export async function afterHireFormSaved(admin: Admin, userId: string): Promise<{ complete: boolean; justCompleted: boolean }> {
  try {
    const { submission } = await loadSubmission(admin, userId)
    if (!submission.complete) return { complete: false, justCompleted: false }

    const { data: profile } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle()
    const firstTime = await queueNotification({
      template:  'onboarding_complete',
      to:        hrNotifyEmails(),
      dedupeKey: `onboarding_complete:${userId}`,
      payload:   { newhireId: userId, hireName: profile?.full_name ?? '', link: appUrl(`/hr/newhire/${userId}`) },
    })

    if (firstTime) {
      await admin.from('audit_log').insert({
        user_id:      userId,
        action_type:  'green',
        message:      '<strong>New hire</strong> has sent every required form to HR',
        performed_by: userId,
      })
    }
    return { complete: true, justCompleted: firstTime }
  } catch {
    console.error('[submission] completion check failed')
    return { complete: false, justCompleted: false }
  }
}
