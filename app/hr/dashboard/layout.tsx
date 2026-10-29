import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/roles'

// Server-side gate for the HR dashboard page (the middleware already routes by role; this checks
// the same requireRole('hr') the API routes use before anything renders).
export default async function HrDashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireRole('hr')
  if (auth instanceof NextResponse) redirect('/login')
  return children
}
