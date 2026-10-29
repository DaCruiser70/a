import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { loadHrVehicleView } from '@/lib/vehicle-server'

// HR's expanded view of the hire's company vehicle request: details (decrypted on the server),
// gas card, and who completed each step. Read-only: HR cannot change the details.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) return auth

  const limit = await rateLimit(await rateLimitKey('hr:vehicle-read', auth.user.id), 120, 10 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  const { id } = await params
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const view = await loadHrVehicleView(createServiceClient(), id)
  if (!view) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(view, { headers: { 'Cache-Control': 'no-store' } })
}
