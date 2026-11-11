import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { computeHireStatus, loadHireStatusInputs } from '@/lib/hire-status'
import type { FormStatus } from '@/types'
import WelcomeView from './WelcomeView'
import type { FormStep, FormStepState } from '@/components/welcome/WireJourney'
import '../../../styles/pages/careers.css'
import { ONBOARDING_ITEMS, ONBOARDING_ITEM_SHORT, type OnboardingItem } from '@/lib/form-order'
import { computeDocumentStatus } from '@/lib/submission'
import '../../../styles/pages/welcome-wire.css'

// The hire's welcome page ("follow the wire"). The banner ring, the header shortcut and station 5
// show real progress: the same five items and the same computeHireStatus as the HR dashboard
// (statuses only; nothing sensitive is read).

export default async function WelcomePage() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) redirect('/login')

  const { forms, docs, req } = await loadHireStatusInputs(createServiceClient(), auth.user.id)
  const computed = computeHireStatus(forms, docs, req)
  // By key, never by position: forms is personal, banking, sin, policy (loadHireStatusInputs)
  const [personal, banking, sin, policy] = forms.map(s => s ?? 'pending') as FormStatus[]
  const byItem: Record<OnboardingItem, FormStatus> = { personal, banking, sin, policy, documents: computeDocumentStatus(docs, req) }

  // Done: approved. Up next: the first item the hire still has to do (not sent, or sent back).
  // An item sent and waiting on HR shows "With HR". Everything else: To do.
  const nextKey = ONBOARDING_ITEMS.find(key => byItem[key] !== 'approved' && byItem[key] !== 'review')
  const steps: FormStep[] = ONBOARDING_ITEMS.map(key => {
    const s = byItem[key]
    const state: FormStepState = s === 'approved' ? 'done'
      : s === 'review' ? 'review'
      : key === nextKey ? 'next'
      : 'todo'
    return { key, label: ONBOARDING_ITEM_SHORT[key], state }
  })

  return <WelcomeView steps={steps} doneCount={computed.approvedCount} />
}
