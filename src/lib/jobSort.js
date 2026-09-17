import { STATUS_LABELS } from './constants.js'
import { jobListDate, sortByKeyDate } from './jobDates.js'

// Sorting the jobs table by any of its columns.
//
// Each column says what it sorts on and which way round it starts. A name
// starts A to Z, because that is how somebody looks a customer up. Money, a
// date and a status start at the far end: the biggest number, the newest day,
// the furthest along, because that is the interesting end of each.
//
// Status and agreement sort by how far along they are rather than
// alphabetically. Sold before Scheduled before Installed is the shape of the
// work; Cancelled, Sold, Scheduled is nothing at all.
//
// A blank always sinks to the bottom, whichever way the column is pointed. A
// job with no parts figure is not the cheapest job, and sorting it to the top
// of an ascending list would say it was.
//
// Pure and importing no components, so npm run check can run it under Node.
// That is also why the agreement status is read off the row here rather than
// through agreements.js, which pulls in the Supabase client.

const STATUS_ORDER = Object.keys(STATUS_LABELS)
const AGREEMENT_ORDER = ['none', 'failed', 'pending', 'sent', 'opened', 'declined', 'expired', 'completed']

function text(value) {
  const s = String(value ?? '').trim().toLowerCase()
  return s === '' ? null : s
}

// Number(null) is 0 and so is Number(''), which would make a job with no parts
// figure the cheapest job on the page rather than one with no figure. Absent
// is checked before the conversion, not after it.
function num(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function rank(list, value) {
  const i = list.indexOf(value)
  return i === -1 ? null : i
}

// key      what to compare, or null when the cell is blank
// start    the direction a first click uses
export const JOB_SORTS = {
  customer: { label: 'Customer', start: 'asc', key: j => text(j.customer_name) },
  sheet: { label: 'Build sheet', start: 'asc', key: j => text(j.system_template) },
  price: { label: 'Price', start: 'desc', key: j => num(j.sale_price) },
  parts: { label: 'Parts', start: 'desc', key: j => num(j.parts_cost_effective) },
  pay: { label: 'Pay', start: 'desc', key: j => num(j.installer_pay) },
  profit: { label: 'Gross profit', start: 'desc', key: j => num(j.margin) },
  status: { label: 'Status', start: 'asc', key: j => rank(STATUS_ORDER, j.status) },
  agreement: { label: 'Agreement', start: 'asc', key: j => rank(AGREEMENT_ORDER, j?.agreement_status || 'none') },
  date: { label: 'Key date', start: 'desc', key: j => {
    const t = jobListDate(j).date?.getTime?.()
    return Number.isFinite(t) ? t : null
  } },
}

export const DEFAULT_SORT = { column: 'date', direction: 'desc' }

export function sortStateFor(column, current) {
  const spec = JOB_SORTS[column]
  if (!spec) return current
  if (current?.column === column) {
    return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { column, direction: spec.start }
}

/**
 * Jobs in the order a column asks for.
 *
 * The default column is the key date, and that path runs sortByKeyDate so the
 * list the page opens on is the one the Key date column has always produced,
 * by the same function, rather than a second implementation that agrees today.
 *
 * Ties keep the order they arrived in, which is newest written up first from
 * the query, because sort is stable. Returns a new array.
 */
export function sortJobs(jobs, sort = DEFAULT_SORT) {
  const list = jobs || []
  const spec = JOB_SORTS[sort?.column]

  if (!spec) return sortByKeyDate(list)
  if (sort.column === DEFAULT_SORT.column && sort.direction === DEFAULT_SORT.direction) {
    return sortByKeyDate(list)
  }

  const way = sort.direction === 'asc' ? 1 : -1

  return [...list].sort((a, b) => {
    const av = spec.key(a)
    const bv = spec.key(b)
    if (av === bv) return 0
    // blanks sink, whichever way the column points
    if (av === null) return 1
    if (bv === null) return -1
    if (typeof av === 'string' || typeof bv === 'string') {
      return String(av).localeCompare(String(bv)) * way
    }
    return (av - bv) * way
  })
}

// What a screen reader should say the column is doing, and what the header
// shows. Only the sorted column carries either.
export function ariaSortOf(column, sort) {
  if (sort?.column !== column) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}
