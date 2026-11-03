import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, VehicleRequest } from '@/types'
import { encrypt, decrypt, isEncrypted } from '@/lib/encrypt'
import { esc } from '@/lib/safe-html'
import { queueNotification, appUrl } from '@/lib/notify'
import { VEHICLE_STEP_EMAILS } from '@/lib/stakeholder-mapping'
import { DRIVERS_LICENSE_TYPE } from '@/lib/required-documents'
import {
  VEHICLE_FIELDS, VEHICLE_TASK_NAME, INSURANCE_TASK_NAME, insuranceWaitingReason,
  type LicenseStatus, type VehicleActorStep, type VehicleDetails, type VehicleStep,
} from '@/lib/vehicle'

// Server only. Company vehicle request: Rob → Heather → (Driver's License approved) → Marley
// (insurance). The details are one encrypted JSON blob and are only ever decrypted here. Values are
// never logged.

type Admin = SupabaseClient<Database>
export type StepAccount = { id: string; name: string; email: string }

// The three existing stakeholder accounts, from VEHICLE_STEP_EMAILS (profiles.aem_email + role)
export async function vehicleStepAccounts(admin: Admin): Promise<Partial<Record<VehicleActorStep, StepAccount>>> {
  const out: Partial<Record<VehicleActorStep, StepAccount>> = {}
  for (const step of ['rob', 'heather', 'marley'] as const) {
    const { data } = await admin
      .from('profiles')
      .select('id, full_name, aem_email')
      .ilike('aem_email', VEHICLE_STEP_EMAILS[step])
      .contains('roles', ['stakeholder'])
      .maybeSingle()
    if (data) out[step] = { id: data.id, name: data.full_name, email: data.aem_email }
  }
  return out
}

// Which step(s) this signed-in stakeholder owns
export function stepsOf(accounts: Partial<Record<VehicleActorStep, StepAccount>>, userId: string): VehicleActorStep[] {
  return (['rob', 'heather', 'marley'] as const).filter(s => accounts[s]?.id === userId)
}

export function encryptDetails(d: VehicleDetails): string | null {
  return Object.keys(d).length ? encrypt(JSON.stringify(d)) : null
}

export function decryptDetails(row: Pick<VehicleRequest, 'details_enc'> | null | undefined): VehicleDetails {
  const v = row?.details_enc
  if (!isEncrypted(v)) return {}
  try {
    const parsed = JSON.parse(decrypt(v)) as Record<string, unknown>
    const out: VehicleDetails = {}
    for (const f of VEHICLE_FIELDS) if (typeof parsed[f] === 'string' && parsed[f]) out[f] = parsed[f] as string
    return out
  } catch {
    console.error('[vehicle] failed to decrypt details')
    return {}
  }
}

async function hireName(admin: Admin, hireId: string): Promise<string> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', hireId).maybeSingle()
  return data?.full_name ?? ''
}

// Names and links only, never vehicle values. One request per hire, so the keys are stable.
export async function queueVehicleNotice(
  admin: Admin, hireId: string, event: 'rob' | 'heather' | 'marley' | 'complete', to: string | string[],
): Promise<void> {
  const template = { rob: 'vehicle_rob_task', heather: 'vehicle_heather_task', marley: 'vehicle_insurance_task', complete: 'vehicle_complete' } as const
  await queueNotification({
    template:  template[event],
    to,
    dedupeKey: `${template[event]}:${hireId}`,
    payload:   {
      newhireId: hireId,
      hireName:  await hireName(admin, hireId),
      link:      appUrl(event === 'complete' ? `/hr/newhire/${hireId}?tab=equipment` : `/stakeholder/newhire/${hireId}`),
    },
  })
}

// HR ticked Company Vehicle: create the request and Rob's task (once). Morley gets nothing.
export async function startVehicleRequest(admin: Admin, hireId: string, hrUserId: string): Promise<'started' | 'exists' | 'no_rob'> {
  const accounts = await vehicleStepAccounts(admin)
  const rob = accounts.rob
  if (!rob) {
    console.error('[vehicle] Rob\'s stakeholder account was not found')
    return 'no_rob'
  }
  const { data: created, error } = await admin.rpc('start_vehicle_request', {
    p_newhire_id: hireId, p_rob_id: rob.id, p_task_name: VEHICLE_TASK_NAME,
  })
  if (error) {
    console.error(`[vehicle] start failed (code ${error.code})`)
    return 'exists'
  }
  if (!created) return 'exists'

  const { data: hr } = await admin.from('profiles').select('full_name').eq('id', hrUserId).maybeSingle()
  await admin.from('audit_log').insert({
    user_id: hireId, action_type: 'navy', performed_by: hrUserId,
    message: `<strong>${esc(hr?.full_name ?? 'HR')}</strong> requested a company vehicle (stakeholder step 1: ${esc(rob.name)})`,
  })
  await queueVehicleNotice(admin, hireId, 'rob', rob.email)
  return 'started'
}

// The hire's Driver's License (one row per hire): its review state and expiry date. No file name
// or path ever leaves here.
export async function driversLicense(admin: Admin, hireId: string): Promise<{ status: LicenseStatus; expiry_date: string | null }> {
  const { data } = await admin
    .from('newhire_documents')
    .select('form_status, expiry_date')
    .eq('user_id', hireId)
    .eq('document_type', DRIVERS_LICENSE_TYPE)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const status: LicenseStatus = !data ? 'missing'
    : data.form_status === 'approved' ? 'approved'
    : data.form_status === 'rejected' ? 'rejected'
    : 'review'
  return { status, expiry_date: data?.expiry_date ?? null }
}

// Starts Marley's insurance step when BOTH Heather has completed and HR has approved the hire's
// Driver's License. Call it after either event; whichever happens last starts it. The database makes
// it one conditional update, so a second call (or a race) does nothing: one task, one notice.
export async function tryStartInsurance(admin: Admin, hireId: string): Promise<boolean> {
  const marley = (await vehicleStepAccounts(admin)).marley
  if (!marley) {
    console.error('[vehicle] Marley\'s stakeholder account was not found')
    return false
  }
  const { data: started, error } = await admin.rpc('start_vehicle_insurance', {
    p_newhire_id: hireId, p_marley_id: marley.id, p_task_name: INSURANCE_TASK_NAME,
  })
  if (error) {
    console.error(`[vehicle] insurance start failed (code ${error.code})`)
    return false
  }
  if (!started) return false

  await admin.from('audit_log').insert({
    user_id: hireId, action_type: 'navy', performed_by: null,
    message: `Vehicle insurance step started (stakeholder step 3: <strong>${esc(marley.name)}</strong>): vehicle details completed and Driver’s License approved`,
  })
  await queueVehicleNotice(admin, hireId, 'marley', marley.email)
  return true
}

// HR unticked Company Vehicle: an unfinished request is cancelled and its open tasks are hidden from
// the stakeholders (kept for HR's history). A complete request is left as it is.
export async function cancelVehicleRequest(admin: Admin, hireId: string, hrUserId: string): Promise<boolean> {
  const { data: cancelled, error } = await admin.rpc('cancel_vehicle_request', { p_newhire_id: hireId })
  if (error) {
    console.error(`[vehicle] cancel failed (code ${error.code})`)
    return false
  }
  if (!cancelled) return false
  const { data: hr } = await admin.from('profiles').select('full_name').eq('id', hrUserId).maybeSingle()
  await admin.from('audit_log').insert({
    user_id: hireId, action_type: 'amber', performed_by: hrUserId,
    message: `<strong>${esc(hr?.full_name ?? 'HR')}</strong> removed Company Vehicle; the unfinished vehicle request was cancelled`,
  })
  return true
}

// HR's expanded view of one hire's request (decrypted here; HR only)
export async function loadHrVehicleView(admin: Admin, hireId: string) {
  const { data: row } = await admin.from('vehicle_requests').select('*').eq('newhire_id', hireId).maybeSingle()
  if (!row) return null
  const ids = [row.rob_completed_by, row.heather_completed_by, row.marley_confirmed_by].filter((v): v is string => !!v)
  const [{ data: people }, license] = await Promise.all([
    ids.length ? admin.from('profiles').select('id, full_name').in('id', ids) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    driversLicense(admin, hireId),
  ])
  const name = (id: string | null) => (id && people?.find(p => p.id === id)?.full_name) || null
  return {
    step:     row.step as VehicleStep,
    details:  decryptDetails(row),
    gas_card: row.gas_card_acquired,
    license:  license.status,
    waiting:  insuranceWaitingReason(row.step as VehicleStep, license.status),
    rob:      { name: name(row.rob_completed_by),     at: row.rob_completed_at },
    heather:  { name: name(row.heather_completed_by), at: row.heather_completed_at },
    marley:   { name: name(row.marley_confirmed_by),  at: row.marley_confirmed_at },
  }
}
export type HrVehicleView = NonNullable<Awaited<ReturnType<typeof loadHrVehicleView>>>
