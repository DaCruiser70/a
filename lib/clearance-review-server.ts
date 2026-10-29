import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { rateLimit, rateLimitKey } from '@/lib/rate-limit'
import { esc } from '@/lib/safe-html'
import { reviewerCanSee } from '@/lib/clearance-package'
import type { PackageStage } from '@/lib/clearance'

// Server only. Shared gate for every /api/clearance route: the 'clearance' role, a rate limit, a
// UUID check and visibility (PSPC & RCMP clearance whose package has been sent). Anything else is
// the same generic 404, so the reviewer can never tell whether other hires exist.

type Admin = SupabaseClient<Database>

export const NOT_FOUND = () => NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })

export type ReviewerContext = { admin: Admin; userId: string; hireId: string; stage: PackageStage }

export async function reviewerGate(
  rawId: string, scope: string, max: number,
): Promise<ReviewerContext | NextResponse> {
  const auth = await requireRole('clearance')
  if (auth instanceof NextResponse) return auth

  const limit = await rateLimit(await rateLimitKey(`clearance:${scope}`, auth.user.id), max, 10 * 60)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    )
  }

  if (!z.uuid().safeParse(rawId).success) return NOT_FOUND()
  const admin = createServiceClient()
  const visible = await reviewerCanSee(admin, rawId)
  if (!visible) return NOT_FOUND()
  return { admin, userId: auth.user.id, hireId: rawId, stage: visible.stage }
}

// "<strong>Name</strong> (clearance review) …" audit row on the hire; no values, ever
export async function auditReviewer(admin: Admin, hireId: string, userId: string, text: string, tone: 'amber' | 'navy' = 'amber'): Promise<void> {
  const { data } = await admin.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  await admin.from('audit_log').insert({
    user_id:      hireId,
    action_type:  tone,
    message:      `<strong>${esc(data?.full_name ?? 'Clearance reviewer')}</strong> (clearance review) ${text}`,
    performed_by: userId,
  })
}
