import type { Metadata } from 'next'
import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/roles'
import { portalForRole } from '@/lib/portals'
import CareerExplorer from '@/components/career/CareerExplorer'
import '../../../styles/pages/careers.css'

// Career Circuit: where a career at AEM could go. New hires and HR only (HR to preview it).
// Static content from lib/career-content.ts; nothing here reads a table or a personal field.
// Two steps in place (components/career/CareerExplorer.tsx): a one-screen intro, then the explorer.
export const metadata: Metadata = {
  title:  'Where could you go? · AEM',
  robots: { index: false, follow: false },
}

export default async function CareersPage() {
  // Same gate as the APIs: newhire, or HR (who also needs a completed sign-in code)
  const auth = await requireRole('newhire', 'hr')
  if (auth instanceof NextResponse) redirect('/login')
  // The back link goes to where the account lands after sign-in: the new hire's welcome page
  // (or, for HR previewing the page, the HR dashboard)
  const back = auth.roles.includes('newhire')
    ? { href: portalForRole('newhire').href, label: 'Back to my welcome page' }
    : { href: portalForRole('hr').href,      label: 'Back to the HR dashboard' }

  return (
    <main className="career-theme cc-page">
      <CareerExplorer back={back} />
    </main>
  )
}
