import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { FormStatus } from '@/types'

export async function GET() {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
