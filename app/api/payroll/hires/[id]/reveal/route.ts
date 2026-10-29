import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { inPayrollQueue } from '@/lib/payroll-access'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { REVEAL_GROUPS } from '@/lib/reveal'
import { auditReveal, decryptRevealGroup } from '@/lib/reveal-server'

const BodySchema = z.strictObject({ group: z.enum(REVEAL_GROUPS) })

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

// Payroll's explicit "View" for one hire: returns one group (banking numbers or SIN), audited with
// the payroll user's name. Same gating as the payroll hire page (payroll role, approved hires only);
// no code step, so the payroll flow is unchanged apart from when the values are fetched.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('payroll')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('payroll:reveal', user.id), 30, 600)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NOT_FOUND()

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { group } = parsed.data

  const admin = createServiceClient()
  const { data: profile } = await admin.from('profiles').select('status, entered_payroll_queue_at').eq('id', id).eq('role', 'newhire').maybeSingle()
  // Same rule as GET /api/payroll/hires/[id] (lib/payroll-access.ts)
  if (!inPayrollQueue(profile)) return NOT_FOUND()

  const values = await decryptRevealGroup(admin, id, group)
  if (!values) return NOT_FOUND()

  await auditReveal(admin, id, user.id, 'Payroll', 'revealed', group, 'payroll')
  return NextResponse.json({ values }, { headers: { 'Cache-Control': 'no-store' } })
}
