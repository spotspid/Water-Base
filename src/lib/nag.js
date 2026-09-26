// The morning reminder rule, as the UI understands it.
//
// These are pure and import nothing, which is the point. The same rule lives
// in SQL, in the nag_candidates view, and the two have to agree exactly: if
// this said a job was quiet while the view still returned it, the button would
// claim one thing while Slack did another every morning. Keeping the
// predicates free of any database import means the repo check can run them.
//
// The sending half lives in agreements.js, which needs Supabase.

export const SNOOZE_CHOICES = [1, 3, 7, 14]

// The window the sweep looks at. A job further out than this is not being
// chased yet, so pausing it would silence nothing.
export const NAG_WINDOW_DAYS = 14

// A date column is YYYY-MM-DD with no zone, so it is compared as a string
// against today rendered the same way. Parsing it into a Date would drag it
// through UTC and turn the 30th into the 29th.
function isoDay(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Paused, and the pause has not run out.
 *
 * The view treats the date as exclusive: nag_snoozed_until <= today means the
 * job is nagged again. This has to use the same boundary, because a button
 * that says "paused until the 30th" while the 30th's sweep posts anyway is
 * worse than no button.
 */
export function isNagPaused(job, now = new Date()) {
  const until = String(job?.nag_snoozed_until || '').slice(0, 10)
  return Boolean(until) && until > isoDay(now)
}

// Whether this job is inside the sweep's window at all. Used to explain why a
// pause would do nothing rather than offering a button that has no effect.
export function isBeingChased(job, now = new Date()) {
  const when = String(job?.scheduled_date || '').slice(0, 10)
  if (!when) return false

  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + NAG_WINDOW_DAYS)
  return when >= isoDay(now) && when <= isoDay(horizon)
}

/**
 * What the sweep is still waiting on.
 *
 * Empty means nothing is outstanding, which is the one condition that stops
 * the reminders for good. A missing status counts as unsigned, because a
 * document nobody has sent is the case most worth chasing.
 */
export function unsignedDocuments(job) {
  const out = []
  if ((job?.agreement_status || 'none') !== 'completed') out.push('the customer agreement')
  if ((job?.work_order_status || 'none') !== 'completed') out.push('the work order')
  return out
}

/**
 * Booked work with no pay written on it.
 *
 * The same rule as the Needs attention list in attention.js and as the
 * payout_nag_candidates view: null, or zero or less. A payout of exactly zero
 * on booked work has always been somebody who never filled it in rather than
 * a crew working for free, and a third definition of "pay not set" is the
 * last thing this app needs.
 */
export function payoutMissing(job) {
  const raw = job?.payout_amount
  if (raw === null || raw === undefined || String(raw).trim() === '') return true
  const pay = Number(raw)
  return !Number.isFinite(pay) || pay <= 0
}

/**
 * Everything the morning sweep is still waiting on, as finished clauses.
 *
 * Empty means the job is not in tomorrow's message, which is the one thing
 * the pause panel must get right: a panel that said nothing while Slack
 * posted every morning would be worse than no panel.
 */
export function nagReasons(job) {
  const reasons = unsignedDocuments(job).map(doc => `${doc} is signed`)
  if (payoutMissing(job)) reasons.push('the installer pay is set')
  return reasons
}

// "a", "a and b", "a, b and c"
export function joinReasons(list) {
  const items = (list || []).filter(Boolean)
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}
