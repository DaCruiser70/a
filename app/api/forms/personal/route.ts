import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    firstName, lastName, dateOfBirth, phone, email,
    street, city, province, postalCode,
    emergencyName, emergencyRelationship, emergencyPhone,
  } = body

  const admin = createServiceClient()

  const { error } = await admin
    .from('personal_info')
    .upsert({
      user_id:                user.id,
      first_name:             firstName,
      last_name:              lastName,
      date_of_birth:          dateOfBirth,
      phone,
      personal_email:         email,
      street,
      city,
      province,
      postal_code:            postalCode,
      emergency_name:         emergencyName,
      emergency_relationship: emergencyRelationship,
      emergency_phone:        emergencyPhone,
      form_status:            'review',
      flag_reason:            null,
    }, { onConflict: 'user_id' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin
    .from('profiles')
    .update({ progress: 25, status: 'in-progress', updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .lt('progress', 25)

  await admin.from('audit_log').insert({
    user_id:      user.id,
    action_type:  'navy',
    message:      `<strong>${firstName} ${lastName}</strong> submitted personal information`,
    performed_by: user.id,
  })

  return NextResponse.json({ ok: true })
}

export async function GET() {
  const ssr   = await createClient()
  const { data: { user } } = await ssr.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createServiceClient()
  const { data } = await admin
    .from('personal_info')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!data) return NextResponse.json({ existing: null })

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
