// The one date a job is filed under, and the order that puts the list in.
//
// A job's date depends on where it has got to: installed on, booked for, or
// written up on. The jobs table shows it in the Key date column and the list
// is sorted by it, so both read this file. Sorting on created_at instead would
// put an install that happened in August under a job written up yesterday,
// which is the thing the column exists to avoid saying.
//
// Pure and importing nothing, so npm run check can run it under Node.

// install_date and scheduled_date are plain YYYY-MM-DD days and are read as
// local days, because new Date('2026-08-25') is UTC midnight and shows Aug 24
// in Michigan.
function localDay(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/**
 * The date a job is filed under, and what that date is.
 *
 * Installed and scheduled only count when the matching date is actually there.
 * An installed job with no install date falls through to when it was written
 * up, which is the truthful thing to show rather than a blank cell.
 */
export function jobListDate(job) {
  if (job?.status === 'installed' && job.install_date) {
    return { kind: 'Installed', date: localDay(job.install_date) }
  }
  if (job?.status === 'scheduled' && job.scheduled_date) {
    return { kind: 'Scheduled', date: localDay(job.scheduled_date) }
  }
  return { kind: 'Written up', date: new Date(job?.created_at) }
}

function stamp(job) {
  const t = jobListDate(job).date?.getTime?.()
  return Number.isFinite(t) ? t : null
}

/**
 * Jobs by their key date, most recent first.
 *
 * A row whose date cannot be read sorts to the bottom rather than to 1970,
 * which is where an unreadable created_at would otherwise land it, at the top
 * of an ascending list or the bottom of this one by accident.
 *
 * Two jobs on the same day keep the order they arrived in, which is the
 * newest first ordering the query already applied, because sort is stable.
 *
 * Returns a new array; the caller's list is not reordered underneath it.
 */
export function sortByKeyDate(jobs) {
  return [...(jobs || [])].sort((a, b) => {
    const at = stamp(a)
    const bt = stamp(b)
    if (at === bt) return 0
    if (at === null) return 1
    if (bt === null) return -1
    return bt - at
  })
}
