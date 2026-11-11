// The Microsoft callback after the code exchange, with every database and session step passed in.
// The route passes the real ones (lib/microsoft-server.ts); scripts/test-microsoft-login.ts passes
// in-memory fakes. No server imports here.

import { landingHref, parseRoles } from '@/lib/portals'
import {
  safeRedirectPath, STAFF_OVER_MEMBER,
  type BindingOwner, type MicrosoftClaims, type MicrosoftDecision, type RefusalReason,
} from '@/lib/microsoft-auth'

export type MicrosoftEvent =
  | { outcome: 'success'; userId: string; memberId: string | null }
  | { outcome: 'refused'; reason: RefusalReason; userId: string | null; memberId: string | null }
  | { outcome: 'note'; reason: typeof STAFF_OVER_MEMBER; userId: string; memberId: null }

export type MicrosoftFlowDeps = {
  decide:        (claims: MicrosoftClaims) => Promise<MicrosoftDecision>
  // The shared account for a member's region: exactly one active one, or null
  pmAccount:     (region: string) => Promise<string | null>
  bind:          (owner: BindingOwner, claims: MicrosoftClaims) => Promise<boolean>
  touch:         (owner: BindingOwner) => Promise<void>
  // An auth user the exchange produced: deleted if it is not one of our accounts, otherwise its
  // Microsoft identities are unlinked
  cleanUp:       (oauthUserId: string) => Promise<void>
  // The app's normal session for the account (and, on a shared account, the signed-in member);
  // its roles from app_metadata, or null on failure
  createSession: (profileId: string, memberId: string | null) => Promise<{ role: unknown; roles: unknown } | null>
  record:        (event: MicrosoftEvent) => Promise<void>
}

export type MicrosoftFlowResult =
  | { ok: true; userId: string; memberId: string | null; redirect: string }
  | { ok: false; reason: RefusalReason; userId: string | null; memberId: string | null }

export async function completeMicrosoftSignIn(
  deps: MicrosoftFlowDeps, oauthUserId: string, claims: MicrosoftClaims,
): Promise<MicrosoftFlowResult> {
  const refuse = async (reason: RefusalReason, userId: string | null, memberId: string | null): Promise<MicrosoftFlowResult> => {
    await deps.record({ outcome: 'refused', reason, userId, memberId })
    return { ok: false, reason, userId, memberId }
  }

  let decision: MicrosoftDecision
  try {
    decision = await deps.decide(claims)
  } catch {
    decision = { allow: false, reason: 'error', userId: null, memberId: null, alsoMember: false }
  }

  // The email is on a staff account AND a team: the staff account was used. Noted on that account.
  const alsoMember = decision.allow ? decision.kind === 'account' && decision.alsoMember : decision.alsoMember
  const accountId  = decision.allow ? (decision.kind === 'account' ? decision.userId : null) : decision.userId
  if (alsoMember && accountId) await deps.record({ outcome: 'note', reason: STAFF_OVER_MEMBER, userId: accountId, memberId: null })

  if (!decision.allow) {
    await deps.cleanUp(oauthUserId)
    return refuse(decision.reason, decision.userId, decision.memberId)
  }

  // Who the session is for: the staff account itself, or the member's regional shared account
  let profileId: string
  let memberId: string | null = null
  let owner: BindingOwner
  if (decision.kind === 'account') {
    profileId = decision.userId
    owner = { kind: 'profile', id: decision.userId }
  } else {
    const shared = await deps.pmAccount(decision.region)
    if (!shared) {
      await deps.cleanUp(oauthUserId)
      return refuse('no_pm_account', null, decision.memberId)
    }
    profileId = shared
    memberId  = decision.memberId
    owner = { kind: 'member', id: decision.memberId }
  }

  // An auth user Supabase created for this Microsoft sign-in (every member sign-in makes one) is
  // never kept
  if (oauthUserId !== profileId) await deps.cleanUp(oauthUserId)

  if (decision.bindNow) {
    // A reused or raced Microsoft id fails the unique constraints: treated as a mismatch
    if (!(await deps.bind(owner, claims))) return refuse('id_mismatch', decision.kind === 'account' ? profileId : null, memberId)
  } else {
    await deps.touch(owner)
  }

  const session = await deps.createSession(profileId, memberId)
  if (!session) return refuse('error', profileId, memberId)

  await deps.record({ outcome: 'success', userId: profileId, memberId })
  const landing = landingHref(session.role, parseRoles(session.roles))
  return { ok: true, userId: profileId, memberId, redirect: safeRedirectPath(landing, landing) }
}
