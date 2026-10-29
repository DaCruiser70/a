import { NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { CLEARANCE_REVEAL_GROUP } from '@/lib/reveal'
import { auditReveal, issueRevealCode } from '@/lib/reveal-server'
import { reviewerGate } from '@/lib/clearance-review-server'

const BodySchema = z.strictObject({ group: z.literal(CLEARANCE_REVEAL_GROUP) })

// The emailed-code reveal from S1, for the clearance reviewer: a 6-digit code to her own email that
// lets her see the hire's legal name, place of birth and DCN for 60 seconds. Same code store,
// limits and audit as HR's reveal; only the 'clearance' group is accepted here.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const gate = await reviewerGate(id, 'reveal-request', 30)
  if (gate instanceof NextResponse) return gate
  const { admin, hireId, userId } = gate

  // 3 per 10 minutes and 10 per hour, as for HR
  for (const [scope, max, window] of [['clearance:reveal-request:10m', 3, 600], ['clearance:reveal-request:1h', 10, 3600]] as const) {
    const limit = await rateLimit(await rateLimitKey(scope, userId), max, window)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many codes requested. Please wait a few minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      )
    }
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  if (!BodySchema.safeParse(raw).success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const { data: me } = await admin.from('profiles').select('aem_email').eq('id', userId).maybeSingle()
  const issued = await issueRevealCode(admin, userId, me?.aem_email, hireId, CLEARANCE_REVEAL_GROUP)
  if (!issued.ok) {
    if (issued.reason === 'unavailable') return NextResponse.json({ error: 'Reveal is unavailable right now. Please try again later.' }, { status: 503 })
    return NextResponse.json({ error: 'Could not send a code. Please try again.' }, { status: 500 })
  }

  await auditReveal(admin, hireId, userId, 'Clearance reviewer', 'requested', CLEARANCE_REVEAL_GROUP, 'clearance review')
  return NextResponse.json(
    issued.devCode ? { ok: true, devCode: issued.devCode } : { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
