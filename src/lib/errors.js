// One place to turn a Supabase or Postgres failure into something a person
// can act on. The install and reversal functions already raise sentences
// written for the user, so those pass straight through. Everything else gets
// translated here rather than leaking a raw driver message into the UI.

// codes raised by our own database functions, all already user readable
const APP_CODES = new Set([
  'WB001', 'WB002', 'WB003', 'WB004', 'WB005',
  'WB006', 'WB007', 'WB008', 'WB009',
])

const MIGRATION_HINT =
  'Apply the migrations in supabase/migrations and reload.'

export function describeError(error, fallback = 'Something went wrong. Try again.') {
  if (!error) return fallback

  const code = error.code || ''
  const message = String(error.message || '').trim()

  if (APP_CODES.has(code)) return message || fallback

  // PostgREST could not find the function or table, which almost always
  // means the migration has not been applied to this project yet.
  if (code === 'PGRST202' || code === 'PGRST205' || code === '42883' || code === '42P01') {
    return `This feature is not set up in the database yet. ${MIGRATION_HINT}`
  }

  if (code === '23505') {
    return 'That row already exists. Refresh and check the current values.'
  }

  if (code === '23503') {
    return 'Another record still points at this one, so it cannot be removed.'
  }

  if (code === '23514' || code === '23502') {
    return message || 'Some values are missing or out of range. Check the form and try again.'
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
