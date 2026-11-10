// Business days for reminders: Monday to Friday, minus the holidays below. Every date here is a
// calendar date in America/Toronto (YYYY-MM-DD). No server imports.

export const TIME_ZONE = 'America/Toronto'

// Statutory holidays to skip. Edit freely: one 'YYYY-MM-DD' per line, the day the office is closed
// (the observed day when the holiday falls on a weekend). AEM works in Ontario, New Brunswick and
// Nova Scotia, so this list is the common set plus the days at least one of them observes.
export const HOLIDAYS: readonly string[] = [
  // 2026
  '2026-01-01', // New Year's Day
  '2026-02-16', // Family Day (ON, NB) / Heritage Day (NS)
  '2026-04-03', // Good Friday
  '2026-05-18', // Victoria Day
  '2026-07-01', // Canada Day
  '2026-08-03', // Civic Holiday (ON) / New Brunswick Day / Natal Day (NS)
  '2026-09-07', // Labour Day
  '2026-10-12', // Thanksgiving
  '2026-11-11', // Remembrance Day (NB, NS)
  '2026-12-25', // Christmas Day
  '2026-12-28', // Boxing Day (observed)
  // 2027
  '2027-01-01', // New Year's Day
  '2027-02-15', // Family Day / Heritage Day
  '2027-03-26', // Good Friday
  '2027-05-24', // Victoria Day
  '2027-07-01', // Canada Day
  '2027-08-02', // Civic Holiday / New Brunswick Day / Natal Day
  '2027-09-06', // Labour Day
  '2027-10-11', // Thanksgiving
  '2027-11-11', // Remembrance Day (NB, NS)
  '2027-12-27', // Christmas Day (observed)
  '2027-12-28', // Boxing Day (observed)
]

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDate(value: string): boolean {
  if (!DATE.test(value)) return false
  const d = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

// The calendar date in Toronto for a moment
export function torontoDate(at: Date | string): string {
  return new Date(at).toLocaleDateString('en-CA', { timeZone: TIME_ZONE })
}

// The hour (0–23) in Toronto for a moment
export function torontoHour(at: Date): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' }).format(at))
}

// Noon UTC keeps day arithmetic clear of daylight-saving changes
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function isBusinessDay(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return day !== 0 && day !== 6 && !HOLIDAYS.includes(date)
}

// Business days after day 0 up to and including `to`. The day of the event is day 0, so an event on
// a Monday is at 3 on Thursday. Never negative.
export function businessDaysBetween(from: string, to: string): number {
  let count = 0
  for (let d = addDays(from, 1); d <= to; d = addDays(d, 1)) {
    if (isBusinessDay(d)) count++
    if (count > 2000) break
  }
  return count
}
