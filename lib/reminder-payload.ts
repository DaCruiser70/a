import { z } from 'zod'
import { REGIONS } from './regions'
import { FLAG_SECTIONS, type Audience } from './notification-templates'

// The queued payload of one daily reminder: one person, one day. Ids, dates and fixed values only:
// never a name, an address, a note or any form contents. Names and counts are looked up when it is
// sent, and every item is checked again then (lib/reminders-render.ts). No server imports.

const id   = z.uuid()
const ids  = z.array(id).max(500)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const region = z.enum(REGIONS)

// Who the email is for. Every target must resolve to the same single address at send time.
export const ReminderTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hire'),        id }),
  z.strictObject({ kind: z.literal('stakeholder'), id }),                 // stakeholder account
  z.strictObject({ kind: z.literal('manager'),     id }),                 // managers.id
  z.strictObject({ kind: z.literal('pm_member'),   id, region }),         // region_teams.id, in that region
  z.strictObject({ kind: z.literal('payroll'),     id }),                 // payroll account
  z.strictObject({ kind: z.literal('hr'),          h: z.string().regex(/^[0-9a-f]{32}$/) }),  // which HR_NOTIFY_EMAILS mailbox (HMAC)
])
export type ReminderTarget = z.infer<typeof ReminderTargetSchema>

export const TARGET_AUDIENCE: Record<ReminderTarget['kind'], Audience> = {
  hire: 'hire', stakeholder: 'stakeholder', manager: 'manager', pm_member: 'pm_region', payroll: 'payroll', hr: 'hr',
}

const pmItem = z.strictObject({ hireId: id, region })

export const DigestSchema = z.strictObject({
  stalled:   ids,
  flagged:   z.array(z.strictObject({ hireId: id, form: z.enum(FLAG_SECTIONS) })).max(500),
  tasks:     ids,                    // stakeholder_tasks.id
  plans:     ids,                    // hire ids
  pm:        z.array(z.strictObject({ hireId: id, region, state: z.enum(['open', 'claimed']), atLimit: z.boolean() })).max(500),
  payroll:   ids,
  needsCall: ids,
  noTeam:    z.array(region).max(REGIONS.length),
  dead:      z.number().int().min(0).max(1_000_000),
})
export type Digest = z.infer<typeof DigestSchema>

export const ReminderSectionsSchema = z.strictObject({
  hire:      z.strictObject({ hireId: id, unfinished: z.boolean(), flagged: z.array(z.enum(FLAG_SECTIONS)).max(FLAG_SECTIONS.length) }).optional(),
  tasks:     ids.optional(),         // stakeholder_tasks.id
  plans:     ids.optional(),         // hire ids whose plan this manager owes
  pmOpen:    z.array(pmItem).max(500).optional(),
  pmClaimed: z.array(pmItem).max(500).optional(),
  payroll:   ids.optional(),
  digest:    DigestSchema.optional(),
})
export type ReminderSections = z.infer<typeof ReminderSectionsSchema>

export const DailyReminderPayloadSchema = z.strictObject({
  date:     date,                                              // the Toronto calendar date it is for
  person:   z.string().regex(/^[0-9a-f]{32}$/),                // HMAC of the address it was grouped by
  to:       z.array(ReminderTargetSchema).min(1).max(20),
  sections: ReminderSectionsSchema,
  refs:     z.array(z.string().regex(/^[a-z]{2}:[A-Za-z0-9:._+ -]{1,200}$/)).max(500),  // what was reminded about
})
export type DailyReminderPayload = z.infer<typeof DailyReminderPayloadSchema>
