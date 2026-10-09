// Local script: seeds the manager directory and gives each manager a sign-in.
// Not an HTTP route. Prints counts only — never names, emails, ids or passwords.
//
// Usage (from the project root):
//   npx tsx --env-file=.env.local scripts/seed-managers.ts --dry-run
//   npx tsx --env-file=.env.local scripts/seed-managers.ts
//
// Safe to re-run. For each manager it:
//   - creates an auth user (role 'manager' in app_metadata) when none exists. The password is
//     random, 24 characters, and never printed, stored or logged; nothing is emailed.
//   - adds 'manager' to roles on an existing profile, keeping its role (landing portal) as is
//   - upserts the managers row by email and links managers.user_id

import { randomInt } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database, UserRole } from '../types'

const DRY_RUN = process.argv.includes('--dry-run')

const MANAGER_NAMES = [
  'Scott LeBlanc', 'Greg MacDonald', 'Morley Norman', 'Neil Rampersad', 'Emile Cormier',
  "Blair O'Neill", 'Michal Denkiewicz', 'Christopher Malay', 'Christopher Barnett', 'Blaine Mayo',
  'Guillaume Boudreau', 'Nathalie Allain', 'Rob Lloyd', 'Charmaine Camannong', 'Brent Atkinson',
  'Wayne Scott',
]

// First initial + last name at aemltd.com; apostrophes and other non-letters removed (Blair O'Neill → boneill)
function managerEmail(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  const first = parts[0].replace(/[^A-Za-z]/g, '')
  const last  = parts[parts.length - 1].replace(/[^A-Za-z]/g, '')
  return `${first[0]}${last}`.toLowerCase() + '@aemltd.com'
}

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
function randomPassword(length = 24): string {
  let out = ''
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]
  return out
}

async function main() {
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(name => !process.env[name])
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
    managers:              MANAGER_NAMES.length,
    authUsersCreated:      0,
    managerRoleAdded:      0, // existing profile gained 'manager'
    alreadyHadManagerRole: 0,
    directoryInserted:     0,
    directoryUpdated:      0,
    directoryUnchanged:    0,
    authUserWithoutProfile: 0, // left untouched; needs a look
    failures:              0,
  }

  console.log(DRY_RUN ? 'DRY RUN — nothing will be written.' : 'LIVE RUN — changes will be written.')

  // Existing directory rows, keyed by email
  const { data: existingRows, error: dirError } = await admin.from('managers').select('id, full_name, email, user_id, active')
  if (dirError) {
    console.error(`Failed to read managers (code ${dirError.code}). Has the migration been run?`)
    process.exit(1)
  }
  const directory = new Map((existingRows ?? []).map(r => [r.email.toLowerCase(), r]))

  // Auth users, keyed by email (paged)
  const authByEmail = new Map<string, string>()
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) {
      console.error(`Failed to list auth users (status ${error.status ?? 'unknown'}). Stopping.`)
      process.exit(1)
    }
    for (const u of data.users) if (u.email) authByEmail.set(u.email.toLowerCase(), u.id)
    if (data.users.length < 1000) break
  }

  for (const fullName of MANAGER_NAMES) {
    const email = managerEmail(fullName)

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, role, roles')
      .ilike('aem_email', email)
      .maybeSingle()
    if (profileError) {
      console.error(`Profile lookup failed (code ${profileError.code}).`)
      counts.failures++
      continue
    }

    let userId: string | null = profile?.id ?? null

    if (profile) {
      const roles = (profile.roles ?? []) as UserRole[]
      if (roles.includes('manager')) {
        counts.alreadyHadManagerRole++
      } else {
        counts.managerRoleAdded++
        if (!DRY_RUN) {
          // role (the landing portal) is left as is; the trigger mirrors roles into app_metadata
          const { error } = await admin
            .from('profiles')
            .update({ roles: [...roles, 'manager'], updated_at: new Date().toISOString() })
            .eq('id', profile.id)
          if (error) { console.error(`Role update failed (code ${error.code}).`); counts.failures++; continue }
        }
      }
    } else if (authByEmail.has(email)) {
      // An auth user with no profile should not happen (the signup trigger creates one)
      counts.authUserWithoutProfile++
      continue
    } else {
      counts.authUsersCreated++
      if (!DRY_RUN) {
        const { data: created, error } = await admin.auth.admin.createUser({
          email,
          password:      randomPassword(),
          email_confirm: true,
          app_metadata:  { role: 'manager' },
          user_metadata: { full_name: fullName },
        })
        if (error || !created.user) {
          console.error(`Auth user creation failed (status ${error?.status ?? 'unknown'}).`)
          counts.failures++
          continue
        }
        userId = created.user.id
      }
    }

    // Directory row: upsert by email and link the account
    const existing = directory.get(email)
    const wanted   = { full_name: fullName, email, user_id: userId, active: true }

    if (!existing) {
      counts.directoryInserted++
    } else if (
      // A manager with no profile gets a new account, so the row always changes
      profile &&
      existing.full_name === wanted.full_name &&
      existing.active &&
      existing.user_id === wanted.user_id
    ) {
      counts.directoryUnchanged++
      continue
    } else {
      counts.directoryUpdated++
    }

    if (!DRY_RUN) {
      const { error } = await admin
        .from('managers')
        .upsert({ ...wanted, updated_at: new Date().toISOString() }, { onConflict: 'email' })
      if (error) { console.error(`Directory upsert failed (code ${error.code}).`); counts.failures++ }
    }
  }

  const verb = DRY_RUN ? ' (would be)' : ''
  console.log('')
  console.log(`Managers in list:                 ${counts.managers}`)
  console.log(`Auth users created${verb}:        ${counts.authUsersCreated}`)
  console.log(`'manager' role added${verb}:      ${counts.managerRoleAdded}`)
  console.log(`Already had 'manager' role:       ${counts.alreadyHadManagerRole}`)
  console.log(`Directory rows inserted${verb}:   ${counts.directoryInserted}`)
  console.log(`Directory rows updated${verb}:    ${counts.directoryUpdated}`)
  console.log(`Directory rows unchanged:         ${counts.directoryUnchanged}`)
  console.log(`Auth users without a profile:     ${counts.authUserWithoutProfile}`)
  console.log(`Failures:                         ${counts.failures}`)

  if (counts.failures > 0) process.exit(1)
}

main().catch(() => {
  console.error('Seed failed unexpectedly.')
  process.exit(1)
})
