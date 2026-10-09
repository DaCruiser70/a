import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/encrypt'
import { recomputeProfileStatus } from '@/lib/hire-status'
import { extFromPath } from '@/lib/download-name'
import { VOID_CHEQUE_BUCKET, VOID_CHEQUE_EXTS } from '@/lib/void-cheque'
import type { BankingInfo, VoidChequeColumn } from '@/types'

// The void cheque is optional for submitting the banking form, so a hire may remove it.
const VOID_CHEQUE_REQUIRED = false

const MAX_NAME_LENGTH = 150

// Original file name for display only (rendered as plain text). Control characters stripped, capped at 150.
function cleanFileName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH).trim()
  return name || fallback
}

export async function POST(request: Request) {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { bankName, accountType, institutionNumber, transitNumber, accountNumber } = body
  const removeVoidCheque = body.removeVoidCheque === true

  // Never trust the client-supplied path: it must be exactly {user.id}/void-cheque.{ext}
  let newPath: string | null = null
  if (body.voidChequePath !== undefined && body.voidChequePath !== null && body.voidChequePath !== '') {
    const allowed = VOID_CHEQUE_EXTS.map(ext => `${user.id}/void-cheque.${ext}`)
    if (typeof body.voidChequePath !== 'string' || !allowed.includes(body.voidChequePath)) {
      return NextResponse.json({ error: 'Invalid void cheque upload. Please choose the file again.' }, { status: 400 })
    }
    newPath = body.voidChequePath
  }

  if (removeVoidCheque && !newPath && VOID_CHEQUE_REQUIRED) {
    return NextResponse.json({ error: 'A void cheque is required. Please upload a new file instead of removing it.' }, { status: 400 })
  }

  const admin = createServiceClient()

  const { data: existing } = await admin
    .from('banking_info')
    .select('void_cheque_path')
    .eq('user_id', user.id)
    .maybeSingle()
  const oldPath = existing?.void_cheque_path ?? null

  // Only the columns included here are written; omitting them preserves the current values.
  let chequeColumns: Partial<Pick<BankingInfo, VoidChequeColumn>> = {}
  let chequeAction: 'replaced' | 'removed' | null = null

  if (newPath) {
    // Size comes from storage, not the client; this also confirms the upload exists
    const fileName = newPath.split('/').pop()!
    const { data: listed, error: listError } = await admin.storage
      .from(VOID_CHEQUE_BUCKET)
      .list(user.id, { search: fileName })
    const object = listed?.find(o => o.name === fileName)
    if (!listError && !object) {
      return NextResponse.json({ error: 'We could not find your uploaded void cheque. Please upload it again.' }, { status: 400 })
    }
    const size = object?.metadata?.size
    chequeColumns = {
      void_cheque_path:        newPath,
      void_cheque_name:        cleanFileName(body.voidChequeName, `void-cheque.${extFromPath(newPath)}`),
      void_cheque_size:        typeof size === 'number' ? size : null,
      void_cheque_uploaded_at: new Date().toISOString(),
    }
    if (oldPath) chequeAction = 'replaced'
  } else if (removeVoidCheque && oldPath) {
    chequeColumns = {
      void_cheque_path:        null,
      void_cheque_name:        null,
      void_cheque_size:        null,
      void_cheque_uploaded_at: null,
    }
    chequeAction = 'removed'
  }

  const { error } = await admin
    .from('banking_info')
    .upsert({
      user_id:                user.id,
      bank_name:              bankName,
      account_type:           accountType,
      institution_number_enc: encrypt(institutionNumber),
      transit_number_enc:     encrypt(transitNumber),
      account_number_enc:     encrypt(accountNumber),
      ...chequeColumns,
      form_status:            'review',
      flag_reason:            null,
      submitted_at:           new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (error) {
    console.error(`banking_info upsert failed (code ${error.code})`)
    return NextResponse.json({ error: 'Failed to save. Please try again.' }, { status: 500 })
  }

  // Delete the superseded object only after the database update has succeeded
  if (chequeAction && oldPath && oldPath !== newPath) {
    const { error: removeError } = await admin.storage.from(VOID_CHEQUE_BUCKET).remove([oldPath])
    if (removeError) console.error('Failed to delete previous void cheque object')
  }

  await recomputeProfileStatus(admin, user.id)

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'navy',
    message:      '<strong>New hire</strong> submitted banking &amp; direct deposit',
    performed_by: user.id,
  })

  if (chequeAction) {
    await admin.from('audit_log').insert({
      user_id:      user.id,
      action_type:  'navy',
      message:      `<strong>New hire</strong> ${chequeAction} their void cheque`,
      performed_by: user.id,
    })
  }

  return NextResponse.json({ ok: true })
}

export async function GET() {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data } = await admin
    .from('banking_info')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return NextResponse.json({ existing: null })

  let institutionNumber = '', transitNumber = '', accountNumber = ''
  try {
    institutionNumber = decrypt(data.institution_number_enc)
    transitNumber     = decrypt(data.transit_number_enc)
    accountNumber     = decrypt(data.account_number_enc)
  } catch { /* key mismatch or corrupted data */ }

  // File details only — the storage path never leaves the server
  let voidCheque: { name: string; size: number | null; uploadedAt: string | null } | null = null
  if (data.void_cheque_path) {
    voidCheque = data.void_cheque_name
      ? { name: data.void_cheque_name, size: data.void_cheque_size ?? null, uploadedAt: data.void_cheque_uploaded_at ?? null }
      // Older uploads stored no details
      : { name: `void-cheque.${extFromPath(data.void_cheque_path)}`, size: null, uploadedAt: null }
  }

  return NextResponse.json({
    existing: {
      bankName:          data.bank_name,
      accountType:       data.account_type,
      institutionNumber,
      transitNumber,
      accountNumber,
      formStatus:        data.form_status,
      flagReason:        data.flag_reason ?? null,
      voidCheque,
    },
  })
}
