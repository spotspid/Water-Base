// What a warranty replacement means on screen.
//
// Pure and importing nothing, so the repo check can run it. The views do the
// counting in the database; this decides how a count reads, which is where
// the mistakes that matter live: a rate with no base printed as a confident
// zero, or a part that failed the day it went in printed as minus one days.

export const WARRANTY_TYPE = 'warranty'

export function isWarranty(txnType) {
  return String(txnType || '') === WARRANTY_TYPE
}

/**
 * Failures as a percentage of a base, or null when there is no base.
 *
 * Null rather than zero on purpose. A part with two failures and no recorded
 * installs has not earned a 0% rate; it has earned a question about where
 * the installs went.
 */
export function failureRate(failures, base) {
  const f = Number(failures) || 0
  const b = Number(base) || 0
  if (b <= 0) return null
  return Math.round((f * 1000) / b) / 10
}

export function rateLabel(rate) {
  const n = Number(rate)
  if (rate === null || rate === undefined || !Number.isFinite(n)) {
    return 'No base to measure against'
  }
  return `${n.toFixed(1)}%`
}

/**
 * How long a part lasted, from the install date to the day it was replaced.
 *
 * Days up to two months, months after that, because "412 days" is a number
 * and "14 months" is a fact about a warranty period.
 */
export function serviceLabel(days) {
  const n = Number(days)
  if (days === null || days === undefined || !Number.isFinite(n)) return 'Install date unknown'
  if (n < 0) return 'Before the recorded install date'
  if (n === 0) return 'Same day'
  if (n === 1) return '1 day in service'
  if (n < 61) return `${n} days in service`
  const months = Math.max(2, Math.round(n / 30.4))
  return `${months} months in service`
}

/**
 * Totals across a list of replacement events.
 *
 * Unknown is not a supplier, so it is left out of the supplier count while
 * its failures still count everywhere else.
 */
export function warrantyTotals(events) {
  const rows = Array.isArray(events) ? events : []
  const skus = new Set()
  const suppliers = new Set()
  let units = 0
  let cost = 0

  for (const row of rows) {
    if (!row) continue
    units += Number(row.units) || 0
    cost += Number(row.cost) || 0
    if (row.sku) skus.add(row.sku)
    if (row.supplier && row.supplier !== 'Unknown') suppliers.add(row.supplier)
  }

  return {
    events: rows.filter(Boolean).length,
    units,
    cost: Math.round(cost * 100) / 100,
    skus: skus.size,
    suppliers: suppliers.size,
  }
}

/**
 * Highest failure rate first, then the most failures, then the name.
 *
 * A row with no rate sorts after every row with one, because a rate that
 * could not be worked out is not a low rate.
 */
export function worstFirst(rows, nameField = 'sku') {
  return [...(Array.isArray(rows) ? rows : [])].filter(Boolean).sort((a, b) => {
    const ar = a.failure_rate_pct == null ? -1 : Number(a.failure_rate_pct)
    const br = b.failure_rate_pct == null ? -1 : Number(b.failure_rate_pct)
    if (ar !== br) return br - ar
    const af = Number(a.failures) || 0
    const bf = Number(b.failures) || 0
    if (af !== bf) return bf - af
    return String(a[nameField] || '').localeCompare(String(b[nameField] || ''), 'en', {
      sensitivity: 'base',
    })
  })
}
