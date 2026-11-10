import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types'

// Server only. The HR "Pause reminders" switch (reminder_settings, one row).

type Admin = SupabaseClient<Database>

export type ReminderSettings = { paused: boolean; changed_at: string | null }

// null when the setting can't be read (table missing, database error)
export async function readReminderSettings(admin: Admin): Promise<ReminderSettings | null> {
  const { data, error } = await admin.from('reminder_settings').select('paused, changed_at').eq('id', true).maybeSingle()
  if (error) {
    console.error(`[reminders] settings lookup failed (code ${error.code})`)
    return null
  }
  return data ? { paused: data.paused, changed_at: data.changed_at } : null
}

// Fails closed: a setting that can't be read counts as paused, so nothing is queued by mistake
export async function remindersPaused(admin: Admin): Promise<boolean> {
  const s = await readReminderSettings(admin)
  return !s || s.paused
}

// Returns true when this call changed it
export async function setRemindersPaused(admin: Admin, paused: boolean, by: string): Promise<boolean> {
  const now = new Date().toISOString()
  const { data, error } = await admin.from('reminder_settings')
    .update({ paused, changed_by: by, changed_at: now, updated_at: now })
    .eq('id', true).eq('paused', !paused)
    .select('id')
  if (error) {
    console.error(`[reminders] settings update failed (code ${error.code})`)
    throw new Error('settings update failed')
  }
  return (data?.length ?? 0) > 0
}
