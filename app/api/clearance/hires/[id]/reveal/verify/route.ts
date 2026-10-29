import { NextResponse } from 'next/server'
import { z } from 'zod'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { CLEARANCE_REVEAL_GROUP } from '@/lib/reveal'
import { auditReveal, decryptRevealGroup, hashRevealCode } from '@/lib/reveal-server'
import { reviewerGate } from '@/lib/clearance-review-server'

const BodySchema = z.strictObject({
  group: z.literal(CLEARANCE_REVEAL_GROUP),
  code:  z.string().regex(/^\d{6}$/),
})
const NO_STORE = { 'Cache-Control': 'no-store' }

// Checks the reviewer's code atomically (verify_reveal_code) and returns the clearance details.
// Values are never logged or stored.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const gate = await reviewerGate(id, 'reveal-verify', 60)
  if (gate instanceof NextResponse) return gate
  const { admin, hireId, userId } = gate

  const limit = await rateLimit(await rateLimitKey('clearance:reveal-verify', userId), 20, 600)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Enter the 6-digit code from your email.' }, { status: 400 })

  const { data: result, error } = await admin.rpc('verify_reveal_code', {
    p_hr_user_id: userId,
    p_hire_id:    hireId,
    p_group:      CLEARANCE_REVEAL_GROUP,
    p_code_hash:  await hashRevealCode(userId, hireId, CLEARANCE_REVEAL_GROUP, parsed.data.code),
  })
  if (error) {
    console.error(`[clearance/reveal] verify failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not check the code. Please try again.' }, { status: 500 })
  }

  const role = 'clearance review'
  if (result === 'bad') {
    await auditReveal(admin, hireId, userId, 'Clearance reviewer', 'wrong', CLEARANCE_REVEAL_GROUP, role)
    return NextResponse.json({ error: 'That code is not right. Check your email and try again.' }, { status: 400 })
  }
  if (result === 'locked') {
    await auditReveal(admin, hireId, userId, 'Clearance reviewer', 'locked', CLEARANCE_REVEAL_GROUP, role)
    return NextResponse.json({ error: 'Too many wrong codes. Request a new code.', expired: true }, { status: 400 })
  }
  if (result !== 'ok') {
    await auditReveal(admin, hireId, userId, 'Clearance reviewer', 'expired', CLEARANCE_REVEAL_GROUP, role)
    return NextResponse.json({ error: 'That code has expired. Request a new code.', expired: true }, { status: 400 })
  }

  const values = await decryptRevealGroup(admin, hireId, CLEARANCE_REVEAL_GROUP)
  if (!values) return NextResponse.json({ error: 'Nothing on file to reveal.' }, { status: 404, headers: NO_STORE })

  await auditReveal(admin, hireId, userId, 'Clearance reviewer', 'revealed', CLEARANCE_REVEAL_GROUP, role)
  return NextResponse.json({ values }, { headers: NO_STORE })
}
