import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { resendPackage } from '@/lib/clearance-package'

const BodySchema = z.strictObject({})

// HR "Fix and resend": a Returned package goes back to Needs review, only when it is ready again.
// HR cannot make any other stage move; the WHERE stage = 'returned' guard makes a double click safe.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:clearance-resend', user.id), 20, 15 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let raw: unknown
  try { raw = await request.json() } catch { raw = {} }
  if (!BodySchema.safeParse(raw ?? {}).success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })

  const admin = createServiceClient()
  const result = await resendPackage(admin, id, user.id)
  if (!result.ok) {
    if (result.reason === 'not_ready') {
      return NextResponse.json({ error: 'The package is not ready to resend yet.', waiting: result.waiting }, { status: 409 })
    }
    if (result.reason === 'conflict' || result.reason === 'invalid') {
      return NextResponse.json({ error: 'This package is not waiting on HR any more. Reload to see its current stage.' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Could not resend. Please try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, stage: result.stage })
}
