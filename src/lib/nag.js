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
