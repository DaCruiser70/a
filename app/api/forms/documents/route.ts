import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  // file_path is deliberately excluded — storage paths never leave the server
  const { data: documents } = await admin
    .from('newhire_documents')
    .select('id, user_id, document_type, document_label, file_name, file_size, expiry_date, form_status, flag_reason, uploaded_at, updated_at, reviewed_at, reviewed_by, sharepoint_filed, sharepoint_filed_at')
    .eq('user_id', user.id)
    .order('uploaded_at', { ascending: false })

  return NextResponse.json({ documents: documents ?? [] })
}

export async function POST(request: Request) {
  const ssr = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { document_type, document_label, file_path, file_name, file_size, expiry_date } = body

  if (!document_type || !document_label || !file_path || !file_name) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Security: file path must be scoped to this user
  if (!file_path.startsWith(user.id + '/')) {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
  }

  const admin = createServiceClient()
  const isMulti = document_type === 'trade_license' || document_type === 'safety_certification'

  if (isMulti) {
    const { error } = await admin.from('newhire_documents').insert({
      user_id:       user.id,
      document_type,
      document_label,
      file_path,
      file_name,
      file_size:     file_size ?? null,
      expiry_date:   expiry_date ?? null,
      form_status:   'review',
      flag_reason:   null,
      reviewed_at:   null,
      reviewed_by:   null,
      sharepoint_filed:    null,
      sharepoint_filed_at: null,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    // Check for existing row
    const { data: existing } = await admin
      .from('newhire_documents')
      .select('id, form_status')
      .eq('user_id', user.id)
      .eq('document_type', document_type)
      .maybeSingle()

    if (existing?.form_status === 'approved') {
      return NextResponse.json({ error: 'Document already approved and cannot be replaced.' }, { status: 409 })
    }

    if (existing) {
      const { error } = await admin.from('newhire_documents').update({
        document_label,
        file_path,
        file_name,
        file_size:   file_size ?? null,
        expiry_date: expiry_date ?? null,
        form_status: 'review',
        flag_reason: null,
        updated_at:  new Date().toISOString(),
      }).eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { error } = await admin.from('newhire_documents').insert({
        user_id:       user.id,
        document_type,
        document_label,
        file_path,
        file_name,
        file_size:     file_size ?? null,
        expiry_date:   expiry_date ?? null,
        form_status:   'review',
        flag_reason:   null,
        reviewed_at:   null,
        reviewed_by:   null,
        sharepoint_filed:    null,
        sharepoint_filed_at: null,
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
