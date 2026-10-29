import { NextResponse } from 'next/server'
import { z } from 'zod'
import { PACKAGE_STAGES, REVIEWER_ACTIONS, RETURN_NOTE_MAX } from '@/lib/clearance'
import { reviewerMove } from '@/lib/clearance-package'
import { reviewerGate } from '@/lib/clearance-review-server'

const BodySchema = z.strictObject({
  action:   z.enum(REVIEWER_ACTIONS),
  expected: z.enum(PACKAGE_STAGES),            // the stage the reviewer was looking at
  note:     z.string().trim().max(RETURN_NOTE_MAX).optional(),
})

// The reviewer moves a package: Needs review → In process → Done, or Needs review / In process →
// Returned (note required). Validated here and again in move_clearance_stage, which only applies
// WHERE the stage still equals `expected`, so a second click or another tab cannot double-apply.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const gate = await reviewerGate(id, 'stage', 60)
  if (gate instanceof NextResponse) return gate
  const { admin, hireId, userId } = gate

  let raw: unknown
  try { raw = await request.json() } catch { raw = null }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  const { action, expected } = parsed.data
  const note = parsed.data.note ?? ''
  if (action === 'return' && note.length < 5) {
    return NextResponse.json({ error: 'Please tell HR what needs fixing (at least 5 characters).' }, { status: 400 })
  }

  const result = await reviewerMove(admin, hireId, userId, action, expected, action === 'return' ? note : null)
  if (!result.ok) {
    if (result.reason === 'conflict' || result.reason === 'invalid') {
      return NextResponse.json({ error: 'This package has already moved to another stage. Reload to see where it is now.' }, { status: 409 })
    }
    if (result.reason === 'note_required') return NextResponse.json({ error: 'A note for HR is required.' }, { status: 400 })
    return NextResponse.json({ error: 'Could not save. Please try again.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, stage: result.stage })
}
