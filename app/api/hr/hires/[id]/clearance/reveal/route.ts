import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { loadClearanceRequirements, decryptClearanceField } from '@/lib/clearance-server'

const BodySchema = z.strictObject({ field: z.enum(['place_of_birth', 'dcn']) })

const COLUMN = { place_of_birth: 'place_of_birth_enc', dcn: 'dcn_enc' } as const
const LABEL  = { place_of_birth: 'place of birth', dcn: 'DCN' } as const

const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

// Decrypts one sensitive clearance field server-side for HR. Every reveal is audited;
// the value never appears in the audit message or in any log.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth
  const { user } = auth

  const limit = await rateLimit(await rateLimitKey('hr:clearance-reveal', user.id), 60, 15 * 60)
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
  const { field } = parsed.data

  const admin = createServiceClient()
  const req = await loadClearanceRequirements(admin, id)
  if (!req.required) return NOT_FOUND()

  const { data: row } = await admin
    .from('clearance_info')
    .select('legal_name_enc, place_of_birth_enc, dcn_enc')
    .eq('user_id', id)
    .maybeSingle()
  const value = decryptClearanceField(row, COLUMN[field])
  if (value === null) return NOT_FOUND()

  await admin.from('audit_log').insert({
    user_id:      id,
    action_type:  'amber',
    message:      `<strong>HR</strong> revealed the clearance ${LABEL[field]}`,
    performed_by: user.id,
  })

  return NextResponse.json({ value }, { headers: { 'Cache-Control': 'no-store' } })
}
