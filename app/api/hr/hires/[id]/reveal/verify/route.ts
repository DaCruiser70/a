import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { REVEAL_GROUPS } from '@/lib/reveal'
import { auditReveal, decryptRevealGroup, hashRevealCode } from '@/lib/reveal-server'

const BodySchema = z.strictObject({
  group: z.enum(REVEAL_GROUPS),
  code:  z.string().regex(/^\d{6}$/),
})

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
const NO_STORE  = { 'Cache-Control': 'no-store' }

// Checks a reveal code (atomically, in verify_reveal_code) and, on success, returns only that
// group's decrypted values. The values are never logged or written anywhere.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:reveal-verify', user.id), 20, 600)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Enter the 6-digit code from your email.' }, { status: 400 })
  const { group, code } = parsed.data

  const admin = createServiceClient()
  const { data: hire } = await admin.from('profiles').select('id').eq('id', id).eq('role', 'newhire').maybeSingle()
  if (!hire) return NOT_FOUND()

  const { data: result, error } = await admin.rpc('verify_reveal_code', {
    p_hr_user_id: user.id,
    p_hire_id:    id,
    p_group:      group,
    p_code_hash:  await hashRevealCode(user.id, id, group, code),
  })
  if (error) {
    console.error(`[reveal] verify failed (code ${error.code})`)
    return NextResponse.json({ error: 'Could not check the code. Please try again.' }, { status: 500 })
  }

  if (result === 'bad') {
    await auditReveal(admin, id, user.id, 'HR', 'wrong', group)
    return NextResponse.json({ error: 'That code is not right. Check your email and try again.' }, { status: 400 })
  }
  if (result === 'locked') {
    await auditReveal(admin, id, user.id, 'HR', 'locked', group)
    return NextResponse.json({ error: 'Too many wrong codes. Request a new code.', expired: true }, { status: 400 })
  }
  if (result !== 'ok') {
    // 'none': no live code for this HR user, hire and group (expired, used, or never issued)
    await auditReveal(admin, id, user.id, 'HR', 'expired', group)
    return NextResponse.json({ error: 'That code has expired. Request a new code.', expired: true }, { status: 400 })
  }

  const values = await decryptRevealGroup(admin, id, group)
  if (!values) return NextResponse.json({ error: 'Nothing on file to reveal.' }, { status: 404, headers: NO_STORE })

  await auditReveal(admin, id, user.id, 'HR', 'revealed', group)
  return NextResponse.json({ values }, { headers: NO_STORE })
}
