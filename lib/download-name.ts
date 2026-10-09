import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'

// Lowercase; spaces/underscores become hyphens; everything except letters, digits and hyphens is stripped.
function slugPart(value: string): string {
  return value
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // é → e
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

// Extension of the stored object (e.g. "pdf"), or '' if none.
export function extFromPath(storedPath: string): string {
  const file = storedPath.split('/').pop() ?? ''
  const dot  = file.lastIndexOf('.')
  return dot > 0 ? file.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : ''
}

// Builds "{prefix}-{lastname}-{firstname}.{ext}" on the server. Never uses a client-supplied name.
export function buildDownloadName(prefix: string, lastName: string, firstName: string, storedPath: string): string {
  const base = [prefix, lastName, firstName].map(slugPart).filter(Boolean).join('-') || 'file'
  const ext  = extFromPath(storedPath)
  return ext ? `${base}.${ext}` : base
}

// The hire's legal name from personal_info, falling back to profiles.full_name.
export async function getHireNameParts(
  admin:  SupabaseClient<Database>,
  hireId: string,
): Promise<{ firstName: string; lastName: string }> {
  const { data: personal } = await admin
    .from('personal_info')
    .select('first_name, last_name')
    .eq('user_id', hireId)
    .maybeSingle()
  if (personal?.first_name || personal?.last_name) {
    return { firstName: personal.first_name ?? '', lastName: personal.last_name ?? '' }
  }

  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', hireId).maybeSingle()
  const parts = (profile?.full_name ?? '').trim().split(/\s+/).filter(Boolean)
  return { firstName: parts.slice(0, -1).join(' ') || (parts[0] ?? ''), lastName: parts.length > 1 ? parts[parts.length - 1] : '' }
}
