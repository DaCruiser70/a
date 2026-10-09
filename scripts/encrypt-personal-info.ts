// One-off local migration: encrypts ENCRYPTED_PERSONAL_FIELDS on existing personal_info rows.
// Not an HTTP route. Prints counts only — never any field values or row contents.
//
// Usage (from the project root):
//   npx tsx --env-file=.env.local scripts/encrypt-personal-info.ts --dry-run
//   npx tsx --env-file=.env.local scripts/encrypt-personal-info.ts
//
// Safe to re-run: values already in the encrypted format are skipped.

import { createClient } from '@supabase/supabase-js'
import { encrypt, decrypt, isEncrypted } from '../lib/encrypt'
import { ENCRYPTED_PERSONAL_FIELDS, type EncryptedPersonalField } from '../lib/personal-fields'
import type { Database } from '../types'

const BATCH_SIZE = 100
const DRY_RUN    = process.argv.includes('--dry-run')

async function main() {
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY']
    .filter(name => !process.env[name])
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const counts = {
    rowsScanned:      0,
    rowsUpdated:      0,
    fieldsEncrypted:  0,
    fieldsSkipped:    0, // already encrypted, null or empty
    failures:         0, // round-trip check failed or update error
    rowsChangedDuringRun: 0, // row was modified after it was read; left untouched
  }

  console.log(DRY_RUN ? 'DRY RUN — no rows will be written.' : 'LIVE RUN — rows will be updated.')

  let lastId: string | null = null

  while (true) {
    let query = admin
      .from('personal_info')
      .select(`id, ${ENCRYPTED_PERSONAL_FIELDS.join(', ')}`)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE)
    if (lastId) query = query.gt('id', lastId)

    const { data, error } = await query
    if (error) {
      console.error(`Failed to read batch (code ${error.code}). Stopping.`)
      counts.failures++
      break
    }

    const rows = (data ?? []) as unknown as Array<{ id: string } & Record<EncryptedPersonalField, string | null>>
    if (rows.length === 0) break

    for (const row of rows) {
      counts.rowsScanned++
      lastId = row.id

      const patch: Partial<Record<EncryptedPersonalField, string>> = {}
      const original: Partial<Record<EncryptedPersonalField, string>> = {}
      let rowFailed = false

      for (const field of ENCRYPTED_PERSONAL_FIELDS) {
        const value = row[field]
        if (value === null || value === '' || isEncrypted(value)) {
          counts.fieldsSkipped++
          continue
        }

        let ciphertext: string
        try {
          ciphertext = encrypt(value)
          if (decrypt(ciphertext) !== value) throw new Error('round-trip mismatch')
        } catch {
          counts.failures++
          rowFailed = true
          continue
        }

        patch[field]    = ciphertext
        original[field] = value
      }

      const fieldCount = Object.keys(patch).length
      if (fieldCount === 0) continue

      // Leave the whole row alone if any of its fields failed the round-trip check
      if (rowFailed) continue

      if (DRY_RUN) {
        counts.fieldsEncrypted += fieldCount
        counts.rowsUpdated++
        continue
      }

      // Only update if the values are still what we read — a concurrent form submission
      // must not be overwritten with an encrypted copy of the older values.
      let update = admin.from('personal_info').update(patch).eq('id', row.id)
      for (const field of Object.keys(original) as EncryptedPersonalField[]) {
        update = update.eq(field, original[field]!)
      }
      const { data: updated, error: updateError } = await update.select('id')

      if (updateError) {
        console.error(`Update failed for a row (code ${updateError.code}).`)
        counts.failures++
      } else if (!updated || updated.length === 0) {
        counts.rowsChangedDuringRun++
      } else {
        counts.fieldsEncrypted += fieldCount
        counts.rowsUpdated++
      }
    }

    if (rows.length < BATCH_SIZE) break
  }

  const verb = DRY_RUN ? ' (would be)' : ''
  console.log('')
  console.log(`Rows scanned:             ${counts.rowsScanned}`)
  console.log(`Rows updated${verb}:      ${counts.rowsUpdated}`)
  console.log(`Fields encrypted${verb}:  ${counts.fieldsEncrypted}`)
  console.log(`Fields skipped:           ${counts.fieldsSkipped}`)
  console.log(`Rows changed during run:  ${counts.rowsChangedDuringRun}`)
  console.log(`Failures:                 ${counts.failures}`)

  if (counts.failures > 0) process.exit(1)
}

main().catch(() => {
  // Deliberately not printing the error: it could contain row data
  console.error('Migration aborted by an unexpected error.')
  process.exit(1)
})
