import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { NewHireRow } from '@/types'

export async function GET() {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (caller?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, full_name, aem_email, position, status, progress, start_date, created_at')
    .eq('role', 'newhire')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const hires: NewHireRow[] = (profiles ?? []).map(p => {
    const submittedDate = p.start_date ?? p.created_at.slice(0, 10)
    const days = Math.floor((Date.now() - new Date(submittedDate).getTime()) / 86_400_000)
    return {
      id:        p.id,
      name:      p.full_name,
      email:     p.aem_email,
      role:      p.position ?? '—',
      status:    p.status,
      progress:  p.progress,
      submitted: submittedDate,
      days:      Math.max(0, days),
    }
  })

  return NextResponse.json({ hires })
}

export async function POST(request: Request) {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (caller?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email, role: position, startDate } = await request.json()

  const tempPassword = Math.random().toString(36).slice(2, 10) + 'Aa1!'
  console.log('[newhire] creating user:', email)
  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email,
    password:      tempPassword,
    email_confirm: true,
    user_metadata: { full_name: name, role: 'newhire' },
  })
  console.log('[newhire] createUser error:', createError?.message ?? null, '| code:', createError?.code ?? null)
  console.log('[newhire] createUser status:', createError?.status ?? null)

  if (createError || !newUser.user) {
    return NextResponse.json({ error: createError?.message ?? 'Failed to create user' }, { status: 500 })
  }
  console.log('[newhire] temp password:', tempPassword)

  // Update profile with position & start date (trigger already created the profile row)
  const { error: updateError } = await admin
    .from('profiles')
    .update({ position, start_date: startDate || null, updated_at: new Date().toISOString() })
    .eq('id', newUser.user.id)
  console.log('[newhire] profile update error:', updateError?.message ?? null)

  return NextResponse.json({ ok: true, tempPassword })
}
