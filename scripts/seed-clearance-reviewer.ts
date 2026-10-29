// Local script: gives the clearance reviewer a sign-in with the 'clearance' role.
// Not an HTTP route. Prints counts only — never names, emails, ids or passwords.
//
// Same method as scripts/seed-managers.ts. The name and email come from the environment, so
// nothing personal is committed:
//   CLEARANCE_REVIEWER_NAME="First Last"  CLEARANCE_REVIEWER_EMAIL="first.last@aemltd.com"
//
// Usage (from the project root):
//   npx tsx --env-file=.env.local scripts/seed-clearance-reviewer.ts --dry-run
//   npx tsx --env-file=.env.local scripts/seed-clearance-reviewer.ts
//
// Safe to re-run. It:
//   - creates an auth user when none exists. The password is random, 24 characters, and never
//     printed, stored or logged; nothing is emailed. She signs in after a password reset, then the
//     usual one-time code, like every other account.
//   - makes sure her profile carries 'clearance' (a new account gets role 'clearance'; an existing
//     account keeps its role, the landing portal, and gains 'clearance' in roles)

import { randomInt } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { Database, UserRole } from '../types'

const DRY_RUN = process.argv.includes('--dry-run')

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
function randomPassword(length = 24): string {
  let out = ''
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]
  return out
}

async function main() {
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'CLEARANCE_REVIEWER_NAME', 'CLEARANCE_REVIEWER_EMAIL']
    .filter(name => !process.env[name]?.trim())
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }
  const fullName = process.env.CLEARANCE_REVIEWER_NAME!.trim()
  const email    = process.env.CLEARANCE_REVIEWER_EMAIL!.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fullName.length > 150) {
    console.error('CLEARANCE_REVIEWER_EMAIL or CLEARANCE_REVIEWER_NAME is not valid.')
    process.exit(1)
  }

  const admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )

  const counts = { authUsersCreated: 0, roleAdded: 0, alreadyHadRole: 0, failures: 0 }
  console.log(DRY_RUN ? 'DRY RUN — nothing will be written.' : 'LIVE RUN — changes will be written.')

  const { data: profile, error: profileError } = await admin
    .from('profiles').select('id, role, roles').ilike('aem_email', email).maybeSingle()
  if (profileError) {
    console.error(`Profile lookup failed (code ${profileError.code}). Has 20261024_clearance_packages.sql been run?`)
    process.exit(1)
  }

  let userId = profile?.id ?? null
  if (!profile) {
    counts.authUsersCreated++
    if (!DRY_RUN) {
      const { data: created, error } = await admin.auth.admin.createUser({
        email,
        password:      randomPassword(),
        email_confirm: true,
        app_metadata:  { role: 'clearance' },
        user_metadata: { full_name: fullName },
      })
      if (error || !created.user) {
        console.error(`Auth user creation failed (status ${error?.status ?? 'unknown'}).`)
        process.exit(1)
      }
      userId = created.user.id
    }
  }

  if (!DRY_RUN && userId) {
    // Set the role explicitly: the signup trigger can run before app_metadata is applied, which
    // would leave a new account as 'newhire'. The roles trigger mirrors this into app_metadata.
    const { data: current } = await admin.from('profiles').select('role, roles').eq('id', userId).maybeSingle()
    const roles = (current?.roles ?? []) as UserRole[]
    if (roles.includes('clearance') && (profile || current?.role === 'clearance')) {
      counts.alreadyHadRole++
    } else {
      const next = profile
        ? { roles: [...roles, 'clearance'] as UserRole[] }                         // keep the landing portal
        : { role: 'clearance' as UserRole, roles: ['clearance'] as UserRole[] }    // new account
      const { error } = await admin.from('profiles')
        .update({ ...next, full_name: profile ? undefined : fullName, updated_at: new Date().toISOString() })
        .eq('id', userId)
      if (error) { console.error(`Role update failed (code ${error.code}).`); counts.failures++ }
      else counts.roleAdded++
    }
  } else if (DRY_RUN && profile) {
    if (((profile.roles ?? []) as UserRole[]).includes('clearance')) counts.alreadyHadRole++
    else counts.roleAdded++
  }

  const verb = DRY_RUN ? ' (would be)' : ''
  console.log('')
  console.log(`Auth users created${verb}:     ${counts.authUsersCreated}`)
  console.log(`'clearance' role set${verb}:   ${counts.roleAdded}`)
  console.log(`Already had 'clearance':       ${counts.alreadyHadRole}`)
  console.log(`Failures:                      ${counts.failures}`)
  if (counts.failures > 0) process.exit(1)
}

main().catch(() => {
  console.error('Seed failed unexpectedly.')
  process.exit(1)
})
