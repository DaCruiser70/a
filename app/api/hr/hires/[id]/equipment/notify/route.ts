import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { STAKEHOLDER_MAP, EQUIPMENT_LABELS } from '@/lib/stakeholder-mapping'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: hireId } = await params
  const body = await request.json()
  const { newlyCheckedItems } = body

  console.log('[notify] hireId:', hireId)
  console.log('[notify] request body:', JSON.stringify(body))
  console.log('[notify] newlyCheckedItems:', newlyCheckedItems)

  if (!Array.isArray(newlyCheckedItems) || newlyCheckedItems.length === 0) {
    console.log('[notify] newlyCheckedItems is empty or not an array — returning early')
    return NextResponse.json({ ok: true, tasksCreated: 0 })
  }

  // Verify hire exists
  const { data: hire, error: hireError } = await admin.from('profiles').select('id').eq('id', hireId).maybeSingle()
  console.log('[notify] hire lookup:', { found: !!hire, error: hireError?.message ?? null })
  if (!hire) return NextResponse.json({ error: 'Hire not found' }, { status: 404 })

  let tasksCreated = 0

  for (const key of newlyCheckedItems as string[]) {
    const emails = STAKEHOLDER_MAP[key]
    console.log(`[notify] key="${key}" → STAKEHOLDER_MAP lookup:`, emails ?? 'NO MATCH')

    if (!emails || emails.length === 0) {
      console.log(`[notify] key="${key}" skipped — no stakeholder mapped`)
      continue
    }

    for (const email of emails) {
      const { data: stakeholder, error: profileError } = await admin
        .from('profiles')
        .select('id')
        .eq('aem_email', email)
        .eq('role', 'stakeholder')
        .maybeSingle()

      console.log(`[notify] profile lookup for email="${email}":`, {
        found: !!stakeholder,
        id: stakeholder?.id ?? null,
        error: profileError?.message ?? null,
      })

      if (!stakeholder) {
        console.log(`[notify] no stakeholder profile found for email="${email}" — skipping`)
        continue
      }

      const payload = {
        newhire_id:   hireId,
        assigned_to:  stakeholder.id,
        task_key:     key,
        task_name:    EQUIPMENT_LABELS[key] ?? key,
        task_details: null,
        status:       'pending' as const,
        confirmed_at: null,
      }
      // Explicit existence check — do not rely on a unique constraint
      const { data: existing, error: existingError } = await admin
        .from('stakeholder_tasks')
        .select('id, status')
        .eq('newhire_id', hireId)
        .eq('assigned_to', stakeholder.id)
        .eq('task_key', key)
        .maybeSingle()

      console.log(`[notify] existence check (newhire_id=${hireId}, assigned_to=${stakeholder.id}, task_key="${key}"):`, {
        found: !!existing,
        status: existing?.status ?? null,
        error: existingError?.message ?? null,
      })

      if (existing) {
        console.log(`[notify] task already exists with status="${existing.status}" — skipping insert`)
        continue
      }

      console.log('[notify] insert payload:', JSON.stringify(payload))

      const { error: insertError, data: insertData } = await admin
        .from('stakeholder_tasks')
        .insert(payload)

      console.log('[notify] insert result:', { data: insertData, error: insertError?.message ?? null, code: insertError?.code ?? null })

      if (!insertError) tasksCreated++
      else console.log('[notify] insert FAILED:', JSON.stringify(insertError))
    }
  }

  console.log('[notify] done. tasksCreated:', tasksCreated)
  return NextResponse.json({ ok: true, tasksCreated })
}
