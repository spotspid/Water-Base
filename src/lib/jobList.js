// The job list, away from the screen that draws it.
//
// Pure, so a plain Node script can check the counting and the sorting without
// a browser or a database.

export const STATUS_ORDER = ['quoted', 'sold', 'scheduled', 'installed', 'cancelled']

export const STATUS_LABEL = {
  quoted: 'Quoted',
  sold: 'Sold',
  scheduled: 'Scheduled',
  installed: 'Installed',
  cancelled: 'Cancelled',
}

/**
 * What a row needs looking at for, in a few words, or nothing.
 *
 * Deliberately short and deliberately few. A list where most rows carry a
 * warning is a list where nobody reads the warnings, which is how eight
 * installs sat unmarked for three weeks on a page that had the information
 * all along.
 */
export function needsLookingAt(job, today = new Date()) {
  if (job.status === 'cancelled') return ''

  const scheduled = job.scheduled_date ? new Date(`${job.scheduled_date}T12:00:00Z`) : null

  if (job.status === 'scheduled' && scheduled && scheduled < today) {
    const days = Math.floor((today - scheduled) / 86400000)
    return `Installed ${days} ${days === 1 ? 'day' : 'days'} ago?`
  }

  if (job.status !== 'quoted' && (job.sale_price === null || job.sale_price === undefined)) {
    return 'No price'
  }

  return ''
}

/**
 * Newest first, but a job waiting on somebody comes above one that is not.
 *
 * Sorting purely by date buries the thing that needs doing under everything
 * that happened since.
 */
export function sortJobs(jobs, today = new Date()) {
  const when = job => job.scheduled_date || job.created_at || ''

  return [...(jobs || [])].sort((a, b) => {
    const aFlag = needsLookingAt(a, today) !== ''
    const bFlag = needsLookingAt(b, today) !== ''

    if (aFlag !== bFlag) return aFlag ? -1 : 1
    return String(when(b)).localeCompare(String(when(a)))
  })
}

export function countByStatus(jobs) {
  const counts = Object.fromEntries(STATUS_ORDER.map(s => [s, 0]))

  for (const job of jobs || []) {
    if (counts[job.status] !== undefined) counts[job.status] += 1
  }

  return counts
}

/**
 * What the list adds up to.
 *
 * Quotes are counted apart from sold work, because adding them together gives
 * a figure that is neither revenue nor pipeline and reads as both. A job with
 * no price contributes nothing and is named, rather than counting as zero.
 */
export function listTotals(jobs) {
  let sold = 0
  let quoted = 0
  let unpriced = 0

  for (const job of jobs || []) {
    if (job.status === 'cancelled') continue

    const price = Number(job.sale_price)

    if (job.sale_price === null || job.sale_price === undefined || !Number.isFinite(price)) {
      unpriced += 1
      continue
    }

    if (job.status === 'quoted') quoted += price
    else sold += price
  }

  return { sold, quoted, unpriced }
}
