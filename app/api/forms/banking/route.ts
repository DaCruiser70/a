import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { afterHireFormSaved } from '@/lib/submission-server'
import { encrypt, decrypt } from '@/lib/encrypt'
import { recomputeProfileStatus } from '@/lib/hire-status'
import { extFromPath } from '@/lib/download-name'
import { VOID_CHEQUE_BUCKET, VOID_CHEQUE_EXTS } from '@/lib/void-cheque'
import type { BankingInfo, VoidChequeColumn } from '@/types'
import { z } from 'zod'
import { ACCOUNT_TYPES, BANK_NAMES, FIELD_LIMITS, UPLOAD_MAX_BYTES, displayFileName } from '@/lib/field-limits'
import { zDigits, firstIssue, readJsonBody, BODY_TOO_LARGE, INVALID_REQUEST } from '@/lib/field-validation'

// The void cheque is optional for submitting the banking form, so a hire may remove it.
const VOID_CHEQUE_REQUIRED = false

// Bank and account type from fixed lists; the three numbers as digits of the exact lengths.
// Encryption is unchanged (encrypt() below), and nothing here ever logs or echoes a value.
const BodySchema = z.strictObject({
  bankName:          z.enum(BANK_NAMES, { error: 'Choose your bank from the list.' }),
  accountType:       z.enum(ACCOUNT_TYPES, { error: 'Choose Chequing or Savings.' }),
  institutionNumber: zDigits('Institution number', FIELD_LIMITS.institutionDigits),
  transitNumber:     zDigits('Transit number', FIELD_LIMITS.transitDigits),
  accountNumber:     zDigits('Account number', FIELD_LIMITS.accountMinDigits, FIELD_LIMITS.accountMaxDigits),
  voidChequePath:    z.string().max(200).nullable().optional(),
  voidChequeName:    z.string().max(500).nullable().optional(),
  removeVoidCheque:  z.boolean().optional(),
})

export async function POST(request: Request) {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const read = await readJsonBody(request)
  if (!read.ok) return NextResponse.json({ error: read.status === 413 ? BODY_TOO_LARGE : INVALID_REQUEST }, { status: read.status })
  const parsed = BodySchema.safeParse(read.data)
  if (!parsed.success) {
    const { field, message } = firstIssue(parsed.error)
    return NextResponse.json({ error: message, field }, { status: 400 })
  }
  const body = parsed.data
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
    if (typeof size === 'number' && size > UPLOAD_MAX_BYTES) {
      await admin.storage.from(VOID_CHEQUE_BUCKET).remove([newPath])
      return NextResponse.json({ error: 'The void cheque is too large. The maximum is 10 MB.' }, { status: 400 })
    }
    chequeColumns = {
      void_cheque_path:        newPath,
      void_cheque_name:        displayFileName(body.voidChequeName, `void-cheque.${extFromPath(newPath)}`),
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

  // Sent to HR on save; the save that completes every required form queues HR's notice once
  const { complete, justCompleted } = await afterHireFormSaved(admin, user.id)

  return NextResponse.json({ ok: true, complete, justCompleted })
}

export async function GET() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

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
