// One place to turn a Supabase or Postgres failure into something a person
// can act on. The install and reversal functions already raise sentences
// written for the user, so those pass straight through. Everything else gets
// translated here rather than leaking a raw driver message into the UI.

// codes raised by our own database functions, all already user readable
const APP_CODES = new Set([
  'WB001', 'WB002', 'WB003', 'WB004', 'WB005',
  'WB006', 'WB007', 'WB008', 'WB009', 'WB010',
  'WB011', 'WB012', 'WB013', 'WB014', 'WB015',
  'WB016', 'WB017', 'WB018', 'WB019',
  'WB020', 'WB021', 'WB022', 'WB023', 'WB024',
  'WB025', 'WB026',
])

const MIGRATION_HINT =
  'Apply the migrations in supabase/migrations and reload.'

// Check constraints raise with the constraint's name and nothing a person
// can act on. The ones a form could plausibly trip are given a sentence.
const CONSTRAINT_MESSAGES = [
  ['jobs_payout_amount_check', 'Installer pay cannot be negative.'],
  ['jobs_sale_price_check', 'The sale price cannot be negative.'],
  ['job_deposits_amount_check', 'A deposit cannot be zero. Enter the amount taken, or a negative amount for a refund.'],
  ['supplier_order_lines_not_over_received', 'More cannot be received on a line than was ordered.'],
]

// An update or delete that matched nothing. supabase-js reports that as a
// success with no rows, so it has to be said here.
export const NOTHING_SAVED =
  'Nothing was saved. The record may have been changed or removed by someone else, '
  + 'or you may be signed out. Reload and try again.'

export function describeError(error, fallback = 'Something went wrong. Try again.') {
  if (!error) return fallback

  const code = error.code || ''
  const message = String(error.message || '').trim()

  if (APP_CODES.has(code)) return message || fallback

  // PostgREST could not find the function, table or column, which almost
  // always means the migration has not been applied to this project yet.
  // 42703 is the one that shows up when a view is a migration behind the
  // code reading it, as when committed and available are asked for before
  // the reservation migration has run.
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42703'
      || code === '42883' || code === '42P01') {
    return `This feature is not set up in the database yet. ${MIGRATION_HINT}`
  }

  if (code === '23505') {
    return 'That row already exists. Refresh and check the current values.'
  }

  if (code === '23503') {
    return 'Another record still points at this one, so it cannot be removed.'
  }

  if (code === '23514') {
    const known = CONSTRAINT_MESSAGES.find(([name]) => message.includes(name))
    if (known) return known[1]
  }

  if (code === '23514' || code === '23502') {
    return message || 'Some values are missing or out of range. Check the form and try again.'
  }

  // A single row was asked for and none came back: the record is gone, or
  // the caller cannot see it any more.
  if (code === 'PGRST116') {
    return NOTHING_SAVED
  }

  if (code === '42501' || code === 'PGRST301') {
    return 'You are not signed in, or your session expired. Sign in again.'
  }

  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Could not reach the database. Check your connection and try again.'
  }

  return message || fallback
}

// Wraps a supabase call so a thrown exception and a returned error land in
// the same shape. Returns { data, error } where error is already a sentence.
export async function attempt(run, fallback) {
  try {
    const { data, error } = await run()
    if (error) return { data: null, error: describeError(error, fallback) }
    return { data, error: null }
  } catch (caught) {
    return { data: null, error: describeError(caught, fallback) }
  }
}

// An update or delete that has to land on at least one row.
//
// A row that a policy filters out, or that somebody else removed, makes an
// update or delete match nothing. Postgres reports that as zero rows and
// supabase-js reports it as success, so every caller that only checked the
// error field told the user it had saved. This asks for the touched rows
// back and treats none as the failure it is.
//
// run returns the query with its filters and no terminal select of its own;
// the select is added here so it cannot be forgotten.
export async function attemptRows(run, fallback) {
  const { data, error } = await attempt(() => run().select('id'), fallback)
  if (error) return { data: null, error }

  const rows = Array.isArray(data) ? data : (data ? [data] : [])
  if (rows.length === 0) return { data: null, error: NOTHING_SAVED }

  return { data: rows, error: null }
}
