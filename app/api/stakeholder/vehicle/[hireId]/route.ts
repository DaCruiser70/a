import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { esc } from '@/lib/safe-html'
import { hrNotifyEmails } from '@/lib/notify'
import {
  VehicleDetailsSchema, GasCardSchema, cleanDetails, VEHICLE_FIELDS, VEHICLE_FIELD_LABELS, GAS_CARD_LABEL,
  VEHICLE_TASK_KEY, VEHICLE_TASK_NAME, INSURANCE_TASK_KEY, INSURANCE_TASK_NAME, VEHICLE_TASK_KEYS,
  type VehicleActorStep, type VehicleStep,
} from '@/lib/vehicle'
import { vehicleStepAccounts, stepsOf, encryptDetails, decryptDetails, queueVehicleNotice } from '@/lib/vehicle-server'

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
const ORDER: VehicleStep[] = ['rob', 'heather', 'marley', 'complete']

const BodySchema = z.discriminatedUnion('step', [
  z.strictObject({ step: z.literal('rob'),     details: VehicleDetailsSchema, gasCard: GasCardSchema }),
  z.strictObject({ step: z.literal('heather'), details: VehicleDetailsSchema, gasCard: GasCardSchema }),
  // Marley confirms insurance only: no details are accepted at this step
  z.strictObject({ step: z.literal('marley') }),
])

async function gate(hireIdRaw: string, scope: string, max: number) {
  const auth = await requireRole('stakeholder')
  if (auth instanceof NextResponse) return auth
  const limit = await rateLimit(await rateLimitKey(`stakeholder:vehicle-${scope}`, auth.user.id), max, 10 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }
  if (!z.uuid().safeParse(hireIdRaw).success) return NOT_FOUND()
  const admin = createServiceClient()
  const [accounts, { data: row }, { data: myTasks }] = await Promise.all([
    vehicleStepAccounts(admin),
    admin.from('vehicle_requests').select('*').eq('newhire_id', hireIdRaw).maybeSingle(),
    admin.from('stakeholder_tasks').select('task_key, status').eq('newhire_id', hireIdRaw).eq('assigned_to', auth.user.id).in('task_key', [...VEHICLE_TASK_KEYS]),
  ])
  const mine = stepsOf(accounts, auth.user.id)
  // Visible only to Rob, Heather and Marley, and only once their own step has started (their task exists)
  if (!row || mine.length === 0 || (myTasks ?? []).length === 0) return NOT_FOUND()
  return { admin, user: auth.user, accounts, row, mine, myTasks: myTasks ?? [] }
}

// The vehicle request as the signed-in stakeholder may see it: the details (decrypted here) and who
// completed which step. Marley sees the same details, read-only.
export async function GET(_request: Request, { params }: { params: Promise<{ hireId: string }> }) {
  const { hireId } = await params
  const g = await gate(hireId, 'read', 240)
  if (g instanceof NextResponse) return g
  const { admin, accounts, row, mine } = g

  const ids = [row.rob_completed_by, row.heather_completed_by, row.marley_confirmed_by].filter((v): v is string => !!v)
  const { data: people } = ids.length ? await admin.from('profiles').select('id, full_name').in('id', ids) : { data: [] }
  const name = (id: string | null) => (id && people?.find(p => p.id === id)?.full_name) || null

  const myTurn = mine.includes(row.step as VehicleActorStep) ? row.step : null
  return NextResponse.json({
    step:     row.step,
    my_step:  myTurn,                        // the step this person may act on now (or null)
    my_steps: mine,
    details:  decryptDetails(row),
    gas_card: row.gas_card_acquired,
    rob:      { name: name(row.rob_completed_by) ?? accounts.rob?.name ?? null,         at: row.rob_completed_at },
    heather:  { name: name(row.heather_completed_by) ?? accounts.heather?.name ?? null, at: row.heather_completed_at },
    marley:   { name: name(row.marley_confirmed_by) ?? accounts.marley?.name ?? null,   at: row.marley_confirmed_at },
  }, { headers: { 'Cache-Control': 'no-store' } })
}

// Completes the signed-in stakeholder's step. Order and identity are checked here; the database
// function applies it only WHERE step = the expected step, so a second click or tab is refused.
export async function POST(request: Request, { params }: { params: Promise<{ hireId: string }> }) {
  const { hireId } = await params
  const g = await gate(hireId, 'act', 30)
  if (g instanceof NextResponse) return g
  const { admin, user, accounts, row, mine } = g

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    // Messages on the detail fields are our own plain sentences (VIN, year, lengths)
    return NextResponse.json({ error: first?.path?.[0] === 'details' ? first.message : 'Please check the vehicle details.' }, { status: 400 })
  }
  const body = parsed.data
  if (!mine.includes(body.step)) return NextResponse.json({ error: 'This step belongs to someone else.' }, { status: 403 })

  const at = ORDER.indexOf(row.step as VehicleStep)
  const want = ORDER.indexOf(body.step)
  if (at > want) return NextResponse.json({ error: 'This step has already been completed.' }, { status: 409 })
  if (at < want) return NextResponse.json({ error: 'It is not your turn yet. The step before yours is still open.' }, { status: 409 })

  // Details: Rob and Heather only
  const before  = decryptDetails(row)
  const details = body.step === 'marley' ? null : cleanDetails(body.details)
  const gas     = body.step === 'marley' ? null : body.gasCard === null ? null : body.gasCard === 'yes'

  const next = body.step === 'rob'     ? { acct: accounts.heather, key: VEHICLE_TASK_KEY,   name: VEHICLE_TASK_NAME }
             : body.step === 'heather' ? { acct: accounts.marley,  key: INSURANCE_TASK_KEY, name: INSURANCE_TASK_NAME }
             : null
  if (next && !next.acct) {
    console.error('[vehicle] next step account was not found')
    return NextResponse.json({ error: 'The next person for this vehicle request could not be found. Please contact HR.' }, { status: 409 })
  }

  const { data: result, error } = await admin.rpc('advance_vehicle_request', {
    p_newhire_id:     hireId,
    p_expected:       body.step,
    p_actor_id:       user.id,
    p_details_enc:    details ? encryptDetails(details) : null,
    p_gas_card:       gas,
    p_next_assignee:  next?.acct?.id ?? null,
    p_next_task_key:  next?.key ?? null,
    p_next_task_name: next?.name ?? null,
  })
  if (error) {
    console.error(`[vehicle] advance failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }
  if (result !== 'ok') return NextResponse.json({ error: 'This step has already been completed.' }, { status: 409 })

  // Audit: who, and which fields (names only, never values)
  const { data: me } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
  const who = `<strong>${esc(me?.full_name ?? 'Stakeholder')}</strong> (stakeholder)`
  let message: string
  if (body.step === 'marley') {
    message = `${who} confirmed the company vehicle insurance`
  } else {
    const fields = body.step === 'rob'
      ? VEHICLE_FIELDS.filter(f => details![f]).map(f => VEHICLE_FIELD_LABELS[f])
      : VEHICLE_FIELDS.filter(f => (before[f] ?? '') !== (details![f] ?? '')).map(f => VEHICLE_FIELD_LABELS[f])
    const gasChanged = body.step === 'rob' ? gas !== null : gas !== row.gas_card_acquired
    if (gasChanged) fields.push(GAS_CARD_LABEL)
    message = body.step === 'rob'
      ? `${who} completed the company vehicle details${fields.length ? ` (filled: ${fields.map(esc).join(', ')})` : ' (no fields filled)'}`
      : `${who} checked and completed the company vehicle details${fields.length ? ` (changed: ${fields.map(esc).join(', ')})` : ' (no changes)'}`
  }
  await admin.from('audit_log').insert({ user_id: hireId, action_type: body.step === 'marley' ? 'green' : 'navy', message, performed_by: user.id })

  // Next person's notice, or HR's when all three are done
  if (body.step === 'rob')     await queueVehicleNotice(admin, hireId, 'heather', accounts.heather!.email)
  if (body.step === 'heather') await queueVehicleNotice(admin, hireId, 'marley', accounts.marley!.email)
  if (body.step === 'marley')  await queueVehicleNotice(admin, hireId, 'complete', hrNotifyEmails())

  return NextResponse.json({ ok: true })
}
