// Date math and shaping for the schedule views.
//
// Every date that crosses the wire here is a Postgres date, which arrives as
// the plain string YYYY-MM-DD with no time and no zone. Passing that string
// to new Date() parses it as midnight UTC, which in any negative offset lands
// on the previous calendar day, so a job booked for the 7th renders on the
// 6th. Every conversion in this file goes through parseISODate instead, which
// builds a local date from the three numbers and never consults a zone.

export const WEEK_LENGTH = 7
export const MONTH_ROWS = 6

// The crew week starts Monday. A service calendar that starts Sunday puts the
// weekend at both ends and splits the working week across two rows.
const WEEK_START_DAY = 1

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function parseISODate(value) {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value))
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return null

  // rejects the 31st of a 30 day month rather than silently rolling forward
  if (date.getMonth() !== month - 1) return null

  return date
}

export function toISODate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayISO() {
  return toISODate(new Date())
}

export function addDays(date, count) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + count)
  return next
}

export function addMonths(date, count) {
  // anchor on the 1st so adding a month to the 31st cannot skip a month
  return new Date(date.getFullYear(), date.getMonth() + count, 1)
}

export function startOfWeek(date) {
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const shift = (base.getDay() - WEEK_START_DAY + WEEK_LENGTH) % WEEK_LENGTH
  return addDays(base, -shift)
}

// The seven days of the week containing the anchor.
export function weekDays(anchor) {
  const first = startOfWeek(anchor)
  return Array.from({ length: WEEK_LENGTH }, (unused, i) => addDays(first, i))
}

// Six rows of seven, always, so the grid does not change height between a
// month that needs five rows and one that needs six.
export function monthGrid(anchor) {
  const first = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  return Array.from({ length: MONTH_ROWS * WEEK_LENGTH }, (unused, i) => addDays(first, i))
}

export function isSameDay(a, b) {
  if (!a || !b) return false
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

export function isToday(date) {
  return isSameDay(date, new Date())
}

export function formatDayNumber(date) {
  return date ? String(date.getDate()) : ''
}

export function formatMonthLabel(date) {
  if (!date) return ''
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

export function formatLongDate(value) {
  const date = value instanceof Date ? value : parseISODate(value)
  if (!date) return ''
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function formatShortDate(value) {
  const date = value instanceof Date ? value : parseISODate(value)
  if (!date) return ''
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// "Week of September 7, 2026", the phrase the schedule is talked about in.
export function formatWeekLabel(anchor) {
  const first = startOfWeek(anchor)
  return `Week of ${first.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })}`
}

// Rows keyed by their calendar day, so a grid cell is one map lookup rather
// than a filter over every job on the page.
export function groupByDate(rows) {
  const byDate = new Map()

  for (const row of rows || []) {
    const key = String(row?.calendar_date || '').slice(0, 10)
    if (!key) continue
    const bucket = byDate.get(key)
    if (bucket) bucket.push(row)
    else byDate.set(key, [row])
  }

  for (const bucket of byDate.values()) bucket.sort(compareWithinDay)

  return byDate
}

// Within a day, order by time window, then by customer. A job with no window
// sorts last, because an unwindowed job is the one still to be pinned down.
export function compareWithinDay(a, b) {
  const windowOrder = (Number(a?.time_window_sort) || 9999) - (Number(b?.time_window_sort) || 9999)
  if (windowOrder !== 0) return windowOrder
  return String(a?.customer_name || '')
    .localeCompare(String(b?.customer_name || ''), 'en', { sensitivity: 'base' })
}

export function sortForList(rows) {
  return [...(rows || [])].sort((a, b) => {
    const aDate = String(a?.calendar_date || '')
    const bDate = String(b?.calendar_date || '')
    // unscheduled jobs sort to the top, since they are the ones needing a date
    if (!aDate && bDate) return -1
    if (aDate && !bDate) return 1
    if (aDate !== bDate) return aDate < bDate ? -1 : 1
    return compareWithinDay(a, b)
  })
}

// A job can be moved only while it is still open. An installed job's date is
// a record of what happened, and a cancelled job is not on the board at all.
export function isMovable(job) {
  return job?.status !== 'installed'
    && job?.status !== 'cancelled'
    && !job?.parts_deducted_at
}

export function crewLabel(job) {
  const lead = job?.installer_name || job?.installer_text || ''
  const helper = job?.helper_name || ''
  if (lead && helper) return `${lead} and ${helper}`
  if (lead) return lead
  return ''
}

export const SCHEDULE_COLUMNS =
  'id, created_at, customer_name, phone, address, city, system_template, template_id, '
  + 'faucet_finish, status, sale_price, invoice_number, notes, scheduled_date, install_date, '
  + 'calendar_date, time_window, time_window_sort, installer_id, installer_name, '
  + 'installer_color, installer_active, helper_id, helper_name, installer_text, parts_deducted_at'
