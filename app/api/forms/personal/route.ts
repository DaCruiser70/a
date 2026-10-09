import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { recomputeProfileStatus } from '@/lib/hire-status'
import { encryptFields, decryptFields } from '@/lib/encrypt'

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export async function POST(request: Request) {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const fields = {
    first_name:             str(body.firstName),
    last_name:              str(body.lastName),
    date_of_birth:          str(body.dateOfBirth),
    phone:                  str(body.phone),
    personal_email:         str(body.email),
    street:                 str(body.street),
    city:                   str(body.city),
    province:               str(body.province),
    postal_code:            str(body.postalCode),
    emergency_name:         str(body.emergencyName),
    emergency_relationship: str(body.emergencyRelationship),
    emergency_phone:        str(body.emergencyPhone),
  }

  if (Object.values(fields).some(v => v === '')) {
    return NextResponse.json({ error: 'Please fill in all required fields.' }, { status: 400 })
  }

  const admin = createServiceClient()

  const { error } = await admin
    .from('personal_info')
    .upsert(encryptFields({
      user_id:      user.id,
      ...fields,
      form_status:  'review' as const,
      flag_reason:  null,
      submitted_at: new Date().toISOString(),
    }), { onConflict: 'user_id' })

  if (error) {
    // Postgres error messages can echo submitted values — log the code only
    console.error(`personal_info upsert failed (code ${error.code})`)
    return NextResponse.json({ error: 'Failed to save. Please try again.' }, { status: 500 })
  }

  await recomputeProfileStatus(admin, user.id)

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'navy',
    message:      `<strong>${fields.first_name} ${fields.last_name}</strong> submitted personal information`,
    performed_by: user.id,
  })

  return NextResponse.json({ ok: true })
}

// Returns the signed-in user's own row, decrypted, for pre-filling the form
export async function GET() {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data: row } = await admin
    .from('personal_info')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!row) return NextResponse.json({ existing: null })

  const data = decryptFields(row)

  return NextResponse.json({
    existing: {
      firstName:             data.first_name,
      lastName:              data.last_name,
      dateOfBirth:           data.date_of_birth,
      phone:                 data.phone,
      email:                 data.personal_email,
      street:                data.street,
      city:                  data.city,
      province:              data.province,
      postalCode:            data.postal_code,
      emergencyName:         data.emergency_name,
      emergencyRelationship: data.emergency_relationship,
      emergencyPhone:        data.emergency_phone,
      formStatus:            data.form_status,
      flagReason:            data.flag_reason ?? null,
    },
  })
}
