import { NextResponse } from 'next/server'
import { CLEARANCE_ID_DOC_TYPES } from '@/lib/clearance'
import { loadProjectBlock, memberNames } from '@/lib/pm-server'
import { reviewerGate } from '@/lib/clearance-review-server'

const ID_LABELS: Record<string, string> = { drivers_license: 'Driver’s licence', alternative_id: 'Alternate ID' }

// One package for the clearance reviewer: hire basics, the stage and its history, the two forms
// (names only), the ID documents on file and the project information. No encrypted value is in
// here: legal name, place of birth, DCN and the date of birth (from Personal Information) come only
// through the emailed-code reveal.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const gate = await reviewerGate(id, 'read', 300)
  if (gate instanceof NextResponse) return gate
  const { admin, hireId } = gate

  const [{ data: hire }, { data: info }, { data: tracking }, { data: history }, { data: docs }, project, { data: plan }, { data: pm }, { data: personal }] = await Promise.all([
    admin.from('profiles').select('full_name, position, office_location, region, start_date').eq('id', hireId).maybeSingle(),
    admin.from('clearance_info').select('rcmp_path, rcmp_name, fingerprint_path, fingerprint_name, legal_name_enc, place_of_birth_enc, dcn_enc').eq('user_id', hireId).maybeSingle(),
    admin.from('clearance_tracking').select('package_stage, package_sent_at, stage_updated_at, stage_updated_by, returned_note, done_at').eq('newhire_id', hireId).maybeSingle(),
    admin.from('clearance_stage_history').select('id, to_stage, actor_id, note, created_at').eq('newhire_id', hireId).order('created_at', { ascending: false }).limit(20),
    admin.from('newhire_documents').select('id, document_type, form_status, uploaded_at').eq('user_id', hireId).in('document_type', [...CLEARANCE_ID_DOC_TYPES]),
    loadProjectBlock(admin, hireId),
    admin.from('manager_plans').select('manager_id').eq('newhire_id', hireId).maybeSingle(),
    admin.from('pm_requests').select('completed_by, completed_at').eq('newhire_id', hireId).maybeSingle(),
    // Ciphertext read only to know whether a date of birth is on file; never decrypted here
    admin.from('personal_info').select('date_of_birth').eq('user_id', hireId).maybeSingle(),
  ])

  const actorIds = [tracking?.stage_updated_by, ...(history ?? []).map(h => h.actor_id)].filter((v): v is string => !!v)
  const [{ data: actors }, { data: manager }, pmNames] = await Promise.all([
    actorIds.length ? admin.from('profiles').select('id, full_name').in('id', actorIds) : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    plan?.manager_id ? admin.from('managers').select('full_name').eq('id', plan.manager_id).maybeSingle() : Promise.resolve({ data: null }),
    memberNames(admin, [pm?.completed_by]),
  ])
  const actorName = (uid: string | null | undefined) => (uid && actors?.find(a => a.id === uid)?.full_name) || null
  const extOf = (p: string | null | undefined) => (p ? p.slice(p.lastIndexOf('.') + 1).toLowerCase() : null)

  return NextResponse.json({
    hire: {
      name:       hire?.full_name ?? '—',
      role:       hire?.position ?? null,
      office:     hire?.office_location ?? null,
      region:     hire?.region ?? null,
      start_date: hire?.start_date ?? null,
    },
    package: {
      stage:            tracking?.package_stage ?? gate.stage,
      sent_at:          tracking?.package_sent_at ?? null,
      stage_updated_at: tracking?.stage_updated_at ?? null,
      stage_by_name:    actorName(tracking?.stage_updated_by),
      returned_note:    tracking?.returned_note ?? null,
      done_at:          tracking?.done_at ?? null,
      history: (history ?? []).map(h => ({ id: h.id, to: h.to_stage, at: h.created_at, by_name: actorName(h.actor_id), note: h.note })),
    },
    forms: {
      rcmp:        info?.rcmp_path        ? { name: info.rcmp_name, ext: extOf(info.rcmp_path) } : null,
      fingerprint: info?.fingerprint_path ? { name: info.fingerprint_name, ext: extOf(info.fingerprint_path) } : null,
    },
    sensitive: {
      has_legal_name:     !!info?.legal_name_enc,
      has_place_of_birth: !!info?.place_of_birth_enc,
      has_dcn:            !!info?.dcn_enc,
      has_date_of_birth:  !!personal?.date_of_birth,
    },
    id_documents: (docs ?? [])
      .filter(d => d.form_status !== 'rejected')
      .map(d => ({ id: d.id, label: ID_LABELS[d.document_type] ?? 'ID', status: d.form_status, uploaded_at: d.uploaded_at })),
    project: {
      ...project.block,
      manager_name:         manager?.full_name ?? null,
      project_manager_name: pm?.completed_by ? pmNames[pm.completed_by] ?? null : null,
      pm_completed_at:      pm?.completed_at ?? null,
    },
  }, { headers: { 'Cache-Control': 'no-store' } })
}
