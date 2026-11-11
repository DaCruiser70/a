import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit, rateLimitKey, rateLimitPeek, getClientIp } from '@/lib/rate-limit'
import type { RefusalReason } from '@/lib/microsoft-auth'
import { completeMicrosoftSignIn } from '@/lib/microsoft-flow'
import {
  microsoftLoginEnabled, takeFlowCookie, exchangeMicrosoftCode, microsoftClaimsFrom, decideFromDatabase,
  bindMicrosoftIdentity, touchMicrosoftIdentity, endExchangeSession, cleanUpAfterRefusal,
  createAppSession, recordMicrosoftAttempt, pmAccountForRegion,
} from '@/lib/microsoft-server'
import { MS_REFUSAL_LIMIT, MS_WINDOW_SECONDS, appRedirect, msRefusedRedirect } from '@/lib/microsoft-routes'

// Microsoft sends the browser back here (through Supabase) with a one-time code. Every check in
// lib/microsoft-auth.ts must pass; any failure creates no session and shows one refusal message.
// The Supabase session from the exchange only identifies the person and is ended either way.

const QuerySchema = z.strictObject({ code: z.string().min(1).max(512) })

export async function GET(request: Request) {
  if (!microsoftLoginEnabled()) return appRedirect(request, '/login')

  const admin = createServiceClient()
  const ip = getClientIp(request)
  const refusedKey = await rateLimitKey('ms-refused:ip', ip)

  // Every refusal also counts toward the stricter per-address refusal limit
  const refused = async () => {
    await rateLimit(refusedKey, MS_REFUSAL_LIMIT, MS_WINDOW_SECONDS)
    return msRefusedRedirect(request)
  }
  const refuseEarly = async (reason: RefusalReason) => {
    await recordMicrosoftAttempt(admin, { outcome: 'refused', reason, userId: null, memberId: null })
    return refused()
  }

  // The start cookie is read and deleted first, so a replayed callback never gets a second try
  const verifierEntry = await takeFlowCookie()

  const [limit, refusals] = await Promise.all([
    rateLimit(await rateLimitKey('ms-callback:ip', ip), 30, MS_WINDOW_SECONDS),
    rateLimitPeek(refusedKey, MS_REFUSAL_LIMIT, MS_WINDOW_SECONDS),
  ])
  if (!limit.allowed || !refusals.allowed) return refuseEarly('rate_limit')

  // Only ?code=…; a provider error, extra parameters or a missing or expired start all end here
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success || !verifierEntry) return refuseEarly('bad_request')

  const exchanged = await exchangeMicrosoftCode(query.data.code, verifierEntry)
  if (!exchanged) return refuseEarly('bad_request')
  const { user: oauthUser, accessToken } = exchanged

  try {
    const result = await completeMicrosoftSignIn({
      decide:        claims => decideFromDatabase(admin, claims),
      pmAccount:     region => pmAccountForRegion(admin, region),
      bind:          (owner, claims) => bindMicrosoftIdentity(admin, owner, claims),
      touch:         owner => touchMicrosoftIdentity(admin, owner),
      cleanUp:       id => cleanUpAfterRefusal(admin, id),
      createSession: async (id, memberId) => {
        const user = await createAppSession(admin, id, memberId)
        return user ? { role: user.app_metadata?.role, roles: user.app_metadata?.roles } : null
      },
      record:        event => recordMicrosoftAttempt(admin, event),
    }, oauthUser.id, microsoftClaimsFrom(oauthUser))

    return result.ok ? appRedirect(request, result.redirect) : refused()
  } catch {
    console.error('[microsoft] callback failed')
    await cleanUpAfterRefusal(admin, oauthUser.id).catch(() => {})
    return refuseEarly('error')
  } finally {
    // Ends only the exchange's own session; the app session created above is separate
    await endExchangeSession(admin, accessToken)
  }
}
