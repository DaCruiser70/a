import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/roles'

// Server-side gate for the clearance reviewer's portal (the middleware already routes by role;
// this runs the same requireRole('clearance') the API routes use before anything renders).
export default async function ClearanceLayout({ children }: { children: React.ReactNode }) {
  const auth = await requireRole('clearance')
  if (auth instanceof NextResponse) redirect('/login')
  return children
}
