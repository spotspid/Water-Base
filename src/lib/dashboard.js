import { CANCELLED_STATUS, STATUS_LABELS } from './constants.js'
import { availableOf, committedOf, isLowStock } from './inventory.js'

// A local ISO day, so date comparisons never touch a timezone. scheduled_date
// is a plain YYYY-MM-DD, and ISO dates sort lexicographically in date order,
// so comparing them as strings is both correct and cheaper than parsing.
function isoDay(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Sold, agreed, and still waiting on a date. This is the queue David works
// from, and it is the number that should be falling.
export function soldNotBooked(jobs) {
  return jobs.filter(job => job.status === 'sold' && !job.scheduled_date)
}

// What is actually coming up. Cancelled and installed jobs are excluded
// because neither is work still to be done.
export function bookedWithin(jobs, days, today = new Date()) {
  const start = isoDay(today)
  const end = isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days))

  return jobs.filter(job => {
    if (job.status === CANCELLED_STATUS || job.status === 'installed') return false
    const when = job.scheduled_date
    return Boolean(when) && when >= start && when <= end
  })
}

// A cancelled job never earned anything, so it is dropped before any money
// is added up. It is deliberately left in the status breakdown, where the
// count is the point.
export function billableJobs(jobs) {
  return jobs.filter(job => job.status !== CANCELLED_STATUS)
}

// The month boundary is taken in the browser's own timezone, so "this month"
// means what it means to the person looking at the screen rather than what it
// means in UTC.
export function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

// The first instant of the following month, so a month range is a half open
// interval and a job installed on the 31st is not silently dropped.
export function monthEnd(start) {
  return new Date(start.getFullYear(), start.getMonth() + 1, 1)
}

export function monthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/**
 * Two different months' worth of money, kept apart.
 *
 * A month total that adds six signed contracts to one finished install is not
 * a number anyone can act on. They answer different questions and they are
 * measured off different dates:
 *
 *   sold      written up this month and not yet installed. What was contracted
 *             and is still owed to the customer. Dated by created_at.
 *   installed installed this month. What was actually delivered, with parts
 *             drawn and a real margin behind it. Dated by install_date, so a
 *             job sold in July and installed in August lands in August.
 *
 * They deliberately overlap. A job written on the 3rd and installed on the
 * 10th is an August booking and an August install, and it belongs in both. An
 * earlier version partitioned them by dropping installed jobs out of sold,
 * which made sold decay: the month's booking figure fell every time a job was
 * delivered, so "sold in August" answered neither what was written nor what is
 * outstanding. Overlapping is the honest shape, and the count of jobs in both
 * is returned so the tiles can say so rather than look like a double count.
 *
 * Cancelled jobs are in neither.
 */
export function splitMonthRevenue(jobs, start) {
  const from = isoDay(start)
  const to = isoDay(monthEnd(start))
  const cutoff = start.getTime()
  const until = monthEnd(start).getTime()

  const empty = { count: 0, revenue: 0 }
  const sold = { ...empty }
  const installed = { ...empty }
  let both = 0

  for (const job of jobs) {
    if (job.status === CANCELLED_STATUS) continue

    const price = Number(job.sale_price) || 0

    // delivered this month, dated by the day it happened
    const day = String(job.install_date || '').slice(0, 10)
    const installedThisMonth = job.status === 'installed'
      && Boolean(day) && day >= from && day < to

    if (installedThisMonth) {
      installed.count += 1
      installed.revenue += price
    }

    // written this month, whatever has become of it since. An installed job
    // still counts here: it was sold this month too, and removing it would
    // shrink the month's bookings as the work got done.
    const written = new Date(job.created_at).getTime()
    const soldThisMonth = Number.isFinite(written) && written >= cutoff && written < until

    if (soldThisMonth) {
      sold.count += 1
      sold.revenue += price
    }

    if (soldThisMonth && installedThisMonth) both += 1
  }

  return { sold, installed, both }
}

// The shape of the pipeline, small enough to say in one sentence.
//
// This used to be a panel with a bar chart. With two statuses in use it was a
// third of the screen spent repeating what the metric tiles already said, and
// a bar whose only comparison was against the one other bar. The counts are
// the whole content, so they are returned as counts and rendered as a line.
export function pipelineSummary(jobs) {
  const counts = new Map(Object.keys(STATUS_LABELS).map(key => [key, 0]))

  for (const job of jobs) {
    const key = job.status || 'unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const rows = [...counts.entries()].map(([status, count]) => ({
    status,
    label: STATUS_LABELS[status] || status,
    count,
  }))

  return {
    total: jobs.length,
    used: rows.filter(row => row.count > 0),
    empty: rows.filter(row => row.count === 0).map(row => row.label.toLowerCase()),
  }
}

// A part can need attention for two reasons, and only one of them is a
// problem today.
//
//   short       nothing free to sell. Every unit on the shelf is promised to a
//               booked job, or more is promised than exists. Salt sits at 8 on
//               hand against a reorder point of 2, so a threshold test says it
//               is fine while all 8 bags are spoken for and the next sale
//               cannot be filled.
//   at the line on hand has reached the reorder point. Still sellable, still
//               enough for the next job. This is a purchasing note, not an
//               alarm, and it belongs on Inventory rather than the dashboard.
//
// Splitting them is the whole point. Mixed together, eight of eleven parts
// read as needing attention and the two that actually did were buried.

function decorate(row) {
  return {
    ...row,
    free: availableOf(row),
    shortfall: (Number(row.reorder_threshold) || 0) - (Number(row.on_hand) || 0),
  }
}

function stockable(rows) {
  return rows.filter(row => row.active !== false)
}

/**
 * Parts a booked job needs and cannot get.
 *
 * The rule used to be "nothing free to sell", which counted anything at zero.
 * That is not a shortage, it is a part you do not stock: 14 SKUs from an
 * unreceived supplier order filled this panel while not one of them blocked a
 * single job, and the whole table became something to scroll past.
 *
 * A shortage needs two things to be true at once. Something has to want the
 * part, which is committed above zero, and the shelf has to be unable to
 * supply it, which is available below zero. Either alone is ordinary: a part
 * nobody has claimed can sit at zero forever, and a part with stock free is
 * fine however popular it is.
 *
 * Worst first, so the part that is furthest oversold leads.
 */
export function stockShortages(stockRows) {
  return stockable(stockRows)
    .filter(row => committedOf(row) > 0 && availableOf(row) < 0)
    .map(decorate)
    .sort((a, b) => {
      if (a.free !== b.free) return a.free - b.free
      return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' })
    })
}

// At or below the reorder point, but with stock still free to sell. A part
// that is genuinely short is deliberately left out: it is already being
// reported as the more serious thing, and listing it twice is how the two
// signals blurred into one in the first place.
export function atReorderPoint(stockRows) {
  return stockable(stockRows)
    .filter(row => isLowStock(row) && availableOf(row) > 0)
    .map(decorate)
    .sort((a, b) => {
      if (b.shortfall !== a.shortfall) return b.shortfall - a.shortfall
      return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' })
    })
}

export function inventoryValue(stockRows) {
  return stockRows.reduce((sum, row) => sum + (Number(row.stock_value) || 0), 0)
}

export function inventoryUnits(stockRows) {
  return stockRows.reduce((sum, row) => sum + (Number(row.on_hand) || 0), 0)
}

// What a ledger row did to the money tied up in stock, signed to match the
// movement. A purchase of ten bags adds their cost, an install of one system
// takes its cost away. The previous sign was the parts consumed convention,
// which is right for job costing and backwards for a stock value delta: it
// showed a positive quantity beside a negative amount on every receipt.
export function costEffect(txn) {
  return Number(txn.quantity || 0) * Number(txn.unit_cost_at_txn || 0)
}

/**
 * Ledger rows folded so that one job reads as one thing that happened.
 *
 * Installing a Flagship Bundle writes five rows, one per part. Shown raw they
 * filled the whole panel with a single install and pushed everything else off
 * the bottom, so "recent activity" answered "what happened once" rather than
 * "what has been happening".
 *
 * Rows are grouped on the job and the deduct batch together, not the job
 * alone. A job can be installed, reversed and installed again, and a later
 * hand correction against the same job is a separate event from the automatic
 * draw, so those must not collapse into each other. A row with no job is its
 * own entry: two unrelated purchases on the same day are two things.
 *
 * A group of one is returned as a plain row, because "1 part drawn" that
 * expands to reveal the one part is worse than just showing it.
 */
export function groupActivity(rows, limit = Infinity) {
  const order = []
  const byKey = new Map()

  rows.forEach((row, index) => {
    const key = row.job_id
      ? `job:${row.job_id}:${row.deduct_batch ?? 'manual'}`
      : `row:${row.id ?? index}`

    if (!byKey.has(key)) {
      byKey.set(key, { key, rows: [] })
      order.push(key)
    }

    byKey.get(key).rows.push(row)
  })

  return order.slice(0, limit).map(key => {
    const group = byKey.get(key)
    const [head] = group.rows

    if (group.rows.length === 1) {
      return { key, single: true, row: head, rows: group.rows }
    }

    const types = new Set(group.rows.map(r => r.txn_type))
    const units = group.rows.reduce((sum, r) => sum + Math.abs(Number(r.quantity) || 0), 0)

    return {
      key,
      single: false,
      row: head,
      rows: group.rows,
      lineCount: group.rows.length,
      units,
      quantity: group.rows.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0),
      value: group.rows.reduce((sum, r) => sum + costEffect(r), 0),
      // one badge only when every row agrees, so a mixed group cannot claim
      // to be a single kind of movement
      txnType: types.size === 1 ? head.txn_type : null,
      customerName: head.jobs?.customer_name || '',
      auto: head.source === 'template',
    }
  })
}
