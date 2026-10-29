import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { REVEAL_GROUPS } from '@/lib/reveal'
import { auditReveal, issueRevealCode } from '@/lib/reveal-server'

const BodySchema = z.strictObject({ group: z.enum(REVEAL_GROUPS) })

const NOT_FOUND   = () => NextResponse.json({ error: 'Not found' }, { status: 404 })
const UNAVAILABLE = () => NextResponse.json({ error: 'Reveal is unavailable right now. Please try again later.' }, { status: 503 })

// Issues a 6-digit code that lets this HR user reveal one group (banking or SIN) for one hire.
// The code goes to the HR user's own email; only its HMAC is stored.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  // 3 per 10 minutes and 10 per hour, per HR user
  for (const [scope, max, window] of [['hr:reveal-request:10m', 3, 600], ['hr:reveal-request:1h', 10, 3600]] as const) {
    const limit = await rateLimit(await rateLimitKey(scope, user.id), max, window)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many codes requested. Please wait a few minutes and try again.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      )
    }
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { group } = parsed.data

  const admin = createServiceClient()
  const { data: hire } = await admin.from('profiles').select('id').eq('id', id).eq('role', 'newhire').maybeSingle()
  if (!hire) return NOT_FOUND()

  const issued = await issueRevealCode(admin, user.id, user.email, id, group)
  if (!issued.ok) {
    if (issued.reason === 'unavailable') return UNAVAILABLE()
    return NextResponse.json({ error: 'Could not send a code. Please try again.' }, { status: 500 })
  }

  await auditReveal(admin, id, user.id, 'HR', 'requested', group)

  return NextResponse.json(
    issued.devCode ? { ok: true, devCode: issued.devCode } : { ok: true },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
