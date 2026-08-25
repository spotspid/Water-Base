// How a supplier order reads on screen.
//
// Pure and importing nothing, so the repo check can run it without a database.
// That matters more here than usual: two of these judgements have to agree
// exactly with SQL that lives somewhere else. OPEN_STATUSES has to match the
// statuses inventory_stock counts toward on order, and arrivalState has to
// compare dates the same way the view does, or the page will promise stock the
// database is not counting.
//
// The querying half lives in orders.js, which needs Supabase.

export const ORDER_STATUS_LABELS = {
  ordered: 'Ordered',
  partial: 'Part delivered',
  received: 'Received',
  cancelled: 'Cancelled',
}

// maps to the shared badge classes
export const ORDER_STATUS_TONE = {
  ordered: 'wait',
  partial: 'wait',
  received: 'good',
  cancelled: 'neutral',
}

// Ordered and part delivered are still coming. Received and cancelled are not,
// which is exactly the test the on order figure uses in SQL.
export const OPEN_STATUSES = ['ordered', 'partial']

export function isOpenOrder(order) {
  return OPEN_STATUSES.includes(order?.status)
}

export function orderStatusLabel(order) {
  return ORDER_STATUS_LABELS[order?.status] || order?.status || 'Unknown'
}

export function orderStatusTone(order) {
  return ORDER_STATUS_TONE[order?.status] || 'neutral'
}

/* ---------------------------------------------------------------------------
   Reading the numbers
--------------------------------------------------------------------------- */

// The freight and tax on top of the invoice price, as a percentage. Shown once
// per order rather than per line, because it is one rate for the whole
// shipment and repeating it eleven times says nothing new.
export function landedUplift(order) {
  const subtotal = Number(order?.subtotal) || 0
  if (subtotal <= 0) return null

  const extra = (Number(order?.freight_amount) || 0) + (Number(order?.tax_amount) || 0)
  if (extra <= 0) return 0

  return (extra / subtotal) * 100
}

/**
 * Whether the lines add up to the invoice, and what to say when they do not.
 *
 * Null means there is nothing to check against, because no invoice total was
 * recorded. A balance of zero is the only clean answer; anything else is a
 * line still to be typed or a price typed wrong, and both are worth catching
 * before the stock arrives at the wrong cost.
 */
export function entryState(order) {
  if (order?.invoice_total == null) return { known: false, balanced: false, remaining: 0 }

  const remaining = Number(order.entry_balance) || 0
  const balanced = Math.abs(remaining) < 0.005

  return { known: true, balanced, remaining }
}

// A date column is YYYY-MM-DD with no zone, so it is compared as a string
// against today rendered the same way rather than parsed into a Date, which
// would drag it through UTC and move it a day.
function isoDay(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * How an expected arrival reads next to a shortage.
 *
 * "Short until the 14th" is the sentence this whole feature exists to make
 * possible, so a date that has already passed has to say so rather than
 * quietly implying the stock is on its way. A supplier who missed the date is
 * a different problem from a supplier who has not got there yet, and only one
 * of them needs chasing.
 */
export function arrivalState(row, now = new Date()) {
  const onOrder = Number(row?.on_order) || 0
  const when = String(row?.expected_arrival || '').slice(0, 10)

  if (onOrder <= 0) return { state: 'none', onOrder: 0, date: '' }
  if (!when) return { state: 'undated', onOrder, date: '' }

  const today = isoDay(now)
  if (when < today) return { state: 'overdue', onOrder, date: when }

  return { state: when === today ? 'today' : 'expected', onOrder, date: when }
}
