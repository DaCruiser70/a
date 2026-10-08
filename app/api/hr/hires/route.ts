import { NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { computeHireStatus } from '@/lib/hire-status'
import type { NewHireRow } from '@/types'

function generateTempPassword(): string {
  const upper   = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const lower   = 'abcdefghijklmnopqrstuvwxyz'
  const digits  = '0123456789'
  const special = '!@#$%^&*'
  const all     = upper + lower + digits + special

  const pick = (set: string) => set[randomBytes(1)[0] % set.length]
  const required = [pick(upper), pick(lower), pick(digits), pick(special)]
  const rest     = Array.from(randomBytes(8)).map(b => all[b % all.length])
  const chars    = [...required, ...rest]

  const shuffleBytes = randomBytes(chars.length)
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffleBytes[i] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export async function GET() {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (caller?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, full_name, aem_email, position, start_date, created_at, office_location')
    .eq('role', 'newhire')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const hireIds = (profiles ?? []).map(p => p.id)

  const [piRows, biRows, siRows, poRows] = hireIds.length
    ? await Promise.all([
        admin.from('personal_info').select('user_id, form_status, submitted_at').in('user_id', hireIds),
        admin.from('banking_info').select('user_id, form_status, submitted_at').in('user_id', hireIds),
        admin.from('sin_info').select('user_id, form_status, submitted_at').in('user_id', hireIds),
        admin.from('policy_acknowledgements').select('user_id, form_status, submitted_at').in('user_id', hireIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]

  const piMap = Object.fromEntries((piRows.data ?? []).map(r => [r.user_id, r]))
  const biMap = Object.fromEntries((biRows.data ?? []).map(r => [r.user_id, r]))
  const siMap = Object.fromEntries((siRows.data ?? []).map(r => [r.user_id, r]))
  const poMap = Object.fromEntries((poRows.data ?? []).map(r => [r.user_id, r]))

  const hires: NewHireRow[] = (profiles ?? []).map(p => {
    const submittedDate = p.start_date ?? p.created_at.slice(0, 10)
    const days = Math.floor((Date.now() - new Date(submittedDate).getTime()) / 86_400_000)
    const computed = computeHireStatus([
      piMap[p.id]?.form_status, biMap[p.id]?.form_status,
      siMap[p.id]?.form_status, poMap[p.id]?.form_status,
    ])
    const timestamps = [
      piMap[p.id]?.submitted_at, biMap[p.id]?.submitted_at,
      siMap[p.id]?.submitted_at, poMap[p.id]?.submitted_at,
    ].filter((t): t is string => !!t)
    const last_submitted_at = timestamps.length > 0
      ? timestamps.reduce((a, b) => (a > b ? a : b))
      : null
    return {
      id:                p.id,
      name:              p.full_name,
      email:             p.aem_email,
      role:              p.position ?? '—',
      status:            computed.status,
      progress:          computed.progressPct,
      submitted:         submittedDate,
      days:              Math.max(0, days),
      last_submitted_at,
      office_location:   p.office_location ?? null,
    }
  })

  return NextResponse.json({ hires })
}

export async function POST(request: Request) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()

  const { data: caller } = await admin.from('profiles').select('role').eq('id', user.id).single()
  if (caller?.role !== 'hr') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const {
    name, preferredName, personalEmail, aemEmail,
    role: position, officeLocation,
    reportingManagerName, reportingManagerEmail,
    startDate, formDeadline, probationPeriod,
  } = await request.json()

  // Calculate probation end date from start date
  let probationEndDate: string | null = null
  if (startDate && probationPeriod !== 'Waived') {
    const start = new Date(startDate)
    start.setDate(start.getDate() + (probationPeriod === '3 Months' ? 90 : 180))
    probationEndDate = start.toISOString().slice(0, 10)
  }
  const probationStatus = probationPeriod === 'Waived' ? 'waived' : 'in-progress'

  const tempPassword = generateTempPassword()

  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email:         aemEmail,
    password:      tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name:      name,
      role:           'newhire',
      personal_email: personalEmail,
      preferred_name: preferredName || null,
    },
  })

  if (createError || !newUser.user) {
    return NextResponse.json({ error: createError?.message ?? 'Failed to create user' }, { status: 500 })
  }

  const { error: updateError } = await admin
    .from('profiles')
    .update({
      position:                position      || null,
      start_date:              startDate     || null,
      preferred_name:          preferredName || null,
      personal_email:          personalEmail,
      office_location:         officeLocation        || null,
      reporting_manager_name:  reportingManagerName  || null,
      reporting_manager_email: reportingManagerEmail || null,
      form_deadline:           formDeadline          || null,
      probation_period:        probationPeriod        || null,
      probation_end_date:      probationEndDate,
      probation_status:        probationStatus,
      updated_at:              new Date().toISOString(),
    })
    .eq('id', newUser.user.id)

  if (updateError) {
    // Clean up orphaned auth user if profile update fails
    await admin.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: 'Failed to set up profile. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: newUser.user.id, tempPassword })
}
