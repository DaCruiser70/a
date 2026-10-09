import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import type { FormStatus } from '@/types'

export async function GET() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const admin = createServiceClient()

  const [
    { data: profile },
    { data: personal },
    { data: banking },
    { data: sin },
    { data: policy },
  ] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', user.id).single(),
    admin.from('personal_info').select('form_status').eq('user_id', user.id).maybeSingle(),
    admin.from('banking_info').select('form_status').eq('user_id', user.id).maybeSingle(),
    admin.from('sin_info').select('form_status').eq('user_id', user.id).maybeSingle(),
    admin.from('policy_acknowledgements').select('form_status').eq('user_id', user.id).maybeSingle(),
  ])

  const formStatuses: Record<string, FormStatus> = {
    personal: (personal?.form_status ?? 'pending') as FormStatus,
    banking:  (banking?.form_status  ?? 'pending') as FormStatus,
    sin:      (sin?.form_status      ?? 'pending') as FormStatus,
    policy:   (policy?.form_status   ?? 'pending') as FormStatus,
  }

  return NextResponse.json({
    name:         profile?.full_name ?? '',
    formStatuses,
  })
}
