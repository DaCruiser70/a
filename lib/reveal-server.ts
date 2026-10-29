import { randomInt } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'
import { decrypt, isEncrypted } from '@/lib/encrypt'
import { hmacHex } from '@/lib/auth-secrets'
import { esc } from '@/lib/safe-html'
import { devOtpEnabled } from '@/lib/otp-issue'
import type { RevealGroup } from '@/lib/reveal'

// Server only. The code that gates reveals of a hire's SIN, banking numbers, personal details
// (date of birth, personal phone) and clearance details.
// The code is never stored (only its HMAC), never logged, never queued in notification_outbox.

type Admin = SupabaseClient<Database>

export const REVEAL_TTL_SECONDS = 300

// The hash binds the code to the HR user, the hire, the group and the 'reveal' purpose
function revealHashInput(hrUserId: string, hireId: string, group: RevealGroup, code: string): string {
  return `reveal:${hrUserId}:${hireId}:${group}:${code}`
}

export function hashRevealCode(hrUserId: string, hireId: string, group: RevealGroup, code: string): Promise<string> {
  return hmacHex('reveal-code', revealHashInput(hrUserId, hireId, group, code))
}

// ── Delivery ──
// Email is sent directly at issue time. No sender is wired up yet: until one is, delivery is
// unavailable, and the route falls back to the development echo (ALLOW_DEV_OTP=true, not
// production) or fails closed. Wire the provider here; never pass the code anywhere else.
export function revealEmailConfigured(): boolean {
  return false
}

async function sendRevealCodeEmail(message: { to: string; code: string; what: string }): Promise<boolean> {
  void message   // no provider wired yet
  return false
}

export type IssueResult =
  | { ok: true; devCode?: string }
  | { ok: false; reason: 'unavailable' | 'error' }

export async function issueRevealCode(
  admin: Admin, hrUserId: string, hrEmail: string | null | undefined, hireId: string, group: RevealGroup,
): Promise<IssueResult> {
  const canEmail = revealEmailConfigured() && !!hrEmail
  const dev      = devOtpEnabled()
  // Fail closed before a code exists when there is no way to deliver it
  if (!canEmail && !dev) return { ok: false, reason: 'unavailable' }

  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const { data: issued, error } = await admin.rpc('issue_reveal_code', {
    p_hr_user_id:  hrUserId,
    p_hire_id:     hireId,
    p_group:       group,
    p_code_hash:   await hashRevealCode(hrUserId, hireId, group, code),
    p_ttl_seconds: REVEAL_TTL_SECONDS,
  })
  if (error || issued !== true) {
    console.error(`[reveal] issue failed (code ${error?.code ?? 'rejected'})`)
    return { ok: false, reason: 'error' }
  }

  if (canEmail) {
    const sent = await sendRevealCodeEmail({ to: hrEmail!, code, what: group === 'sin' ? 'SIN' : group === 'clearance' ? 'clearance details' : group === 'personal' ? 'personal details' : 'banking numbers' })
    if (sent) return { ok: true }
    if (!dev) return { ok: false, reason: 'unavailable' }
  }
  return { ok: true, devCode: code }
}

// ── Values ──

export type RevealValues =
  | { group: 'banking'; institution_number: string; transit_number: string; account_number: string }
  | { group: 'sin'; sin: string }
  | { group: 'personal'; date_of_birth: string | null; personal_phone: string | null }
  | { group: 'clearance'; legal_name: string | null; place_of_birth: string | null; dcn: string | null; date_of_birth: string | null }

// Decrypts one group for one hire. null when there is nothing on file or it cannot be decrypted.
export async function decryptRevealGroup(admin: Admin, hireId: string, group: RevealGroup): Promise<RevealValues | null> {
  try {
    if (group === 'banking') {
      const { data } = await admin
        .from('banking_info')
        .select('institution_number_enc, transit_number_enc, account_number_enc')
        .eq('user_id', hireId).maybeSingle()
      if (!data?.account_number_enc) return null
      return {
        group:              'banking',
        institution_number: decrypt(data.institution_number_enc),
        transit_number:     decrypt(data.transit_number_enc),
        account_number:     decrypt(data.account_number_enc),
      }
    }
    if (group === 'personal') {
      const personal = await personalReveal(admin, hireId)
      if (!personal.date_of_birth && !personal.personal_phone) return null
      return { group: 'personal', ...personal }
    }
    if (group === 'clearance') {
      // The date of birth lives in Personal Information; the clearance form does not ask for it
      const [{ data }, personal] = await Promise.all([
        admin.from('clearance_info')
          .select('legal_name_enc, place_of_birth_enc, dcn_enc')
          .eq('user_id', hireId).maybeSingle(),
        personalReveal(admin, hireId),
      ])
      if (!data) return null
      const d = (v: string | null) => (v ? decrypt(v) : null)
      return {
        group: 'clearance', legal_name: d(data.legal_name_enc), place_of_birth: d(data.place_of_birth_enc), dcn: d(data.dcn_enc),
        date_of_birth: personal.date_of_birth,
      }
    }
    const { data } = await admin.from('sin_info').select('sin_enc').eq('user_id', hireId).maybeSingle()
    if (!data?.sin_enc) return null
    return { group: 'sin', sin: decrypt(data.sin_enc) }
  } catch {
    return null   // bad key or corrupted data; never log the cause
  }
}

// Date of birth and personal phone from personal_info. Rows written before encryption hold plain
// values (decryptFields passes those through too).
async function personalReveal(admin: Admin, hireId: string): Promise<{ date_of_birth: string | null; personal_phone: string | null }> {
  const { data } = await admin
    .from('personal_info')
    .select('date_of_birth, personal_phone')
    .eq('user_id', hireId).maybeSingle()
  const d = (v: string | null | undefined) => (!v ? null : isEncrypted(v) ? decrypt(v) : v)
  return { date_of_birth: d(data?.date_of_birth), personal_phone: d(data?.personal_phone) }
}

// ── Audit (no values, no codes) ──

export async function auditReveal(
  admin: Admin, hireId: string, actorId: string, actorLabel: string,
  event: 'requested' | 'revealed' | 'wrong' | 'locked' | 'expired', group: RevealGroup, roleLabel?: string,
): Promise<void> {
  const [{ data: actor }, { data: hire }] = await Promise.all([
    admin.from('profiles').select('full_name').eq('id', actorId).maybeSingle(),
    admin.from('profiles').select('full_name').eq('id', hireId).maybeSingle(),
  ])
  const who  = `<strong>${esc(actor?.full_name ?? actorLabel)}</strong>${roleLabel ? ` (${esc(roleLabel)})` : ''}`
  const what = group === 'sin' ? 'the SIN' : group === 'clearance' ? 'the clearance details' : group === 'personal' ? 'the personal details' : 'the banking numbers'
  const of   = `<strong>${esc(hire?.full_name ?? 'this hire')}</strong>`
  const message = {
    requested: `${who} requested a reveal code for ${what} of ${of}`,
    revealed:  `${who} revealed ${what} of ${of}`,
    wrong:     `${who} entered a wrong reveal code for ${what} of ${of}`,
    locked:    `${who} used up the attempts on a reveal code for ${what} of ${of}`,
    expired:   `${who} tried an expired or used reveal code for ${what} of ${of}`,
  }[event]
  await admin.from('audit_log').insert({
    user_id:      hireId,
    action_type:  event === 'revealed' || event === 'requested' ? 'amber' : 'red',
    message,
    performed_by: actorId,
  })
}
