import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/roles'
import { computeHireStatus, loadHireStatusInputs } from '@/lib/hire-status'
import type { FormStatus } from '@/types'
import WelcomeView from './WelcomeView'
import type { FormStep, FormStepState } from '@/components/welcome/WireJourney'
import '../../../styles/pages/careers.css'
import '../../../styles/pages/welcome-wire.css'

// The hire's welcome page ("follow the wire"). The banner ring, the header shortcut and station 5
// show real progress: the same five items and the same computeHireStatus as the HR dashboard
// (statuses only; nothing sensitive is read).
const STEP_LABELS = ['Personal Info', 'Banking', 'SIN', 'Policies', 'Documents'] as const
const STEP_KEYS   = ['personal', 'banking', 'sin', 'policy', 'documents'] as const

export default async function WelcomePage() {
  const auth = await requireRole('newhire')
  if (auth instanceof NextResponse) redirect('/login')

  const { forms, docs, req } = await loadHireStatusInputs(createServiceClient(), auth.user.id)
  const computed = computeHireStatus(forms, docs, req)
  const statuses: FormStatus[] = [...forms.map(s => s ?? 'pending'), computed.documents.status]

  // Done: approved. Up next: the first item the hire still has to do (not sent, or sent back).
  // An item sent and waiting on HR shows "With HR". Everything else: To do.
  let nextFound = false
  const steps: FormStep[] = statuses.map((s, i) => {
    let state: FormStepState
    if (s === 'approved')    state = 'done'
    else if (s === 'review') state = 'review'
    else if (!nextFound)     { state = 'next'; nextFound = true }
    else                     state = 'todo'
    return { key: STEP_KEYS[i], label: STEP_LABELS[i], state }
  })

  return <WelcomeView steps={steps} doneCount={computed.approvedCount} />
}
