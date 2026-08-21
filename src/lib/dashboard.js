import { CANCELLED_STATUS, STATUS_LABELS } from './constants'
import { isLowStock } from './inventory'

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

export function monthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

const EMPTY_TOTALS = {
  count: 0, revenue: 0, parts: 0, pay: 0, margin: 0, avgMargin: null,
  installedCount: 0, pendingCount: 0, projected: false,
}

// Margin on a job that has not been installed is a forecast, not a result. Its
// parts have been committed but not drawn, and no payout has been entered, so
// the margin equals the whole sale price and reads as 100 percent of revenue.
// The totals still include it, because that is the pipeline, but the caller is
// told how many jobs are unearned so it can say so rather than imply certainty.
export function summarizeJobs(jobs) {
  if (jobs.length === 0) return EMPTY_TOTALS

  const totals = jobs.reduce((acc, job) => ({
    count: acc.count + 1,
    revenue: acc.revenue + (Number(job.sale_price) || 0),
    parts: acc.parts + (Number(job.parts_cost) || 0),
    pay: acc.pay + (Number(job.installer_pay) || 0),
    margin: acc.margin + (Number(job.margin) || 0),
  }), { count: 0, revenue: 0, parts: 0, pay: 0, margin: 0 })

  const installedCount = jobs.filter(job => job.status === 'installed').length

  return {
    ...totals,
    avgMargin: totals.margin / totals.count,
    installedCount,
    pendingCount: totals.count - installedCount,
    projected: installedCount < totals.count,
  }
}

export function jobsSince(jobs, since) {
  const cutoff = since.getTime()
  return jobs.filter(job => {
    const created = new Date(job.created_at).getTime()
    return Number.isFinite(created) && created >= cutoff
  })
}

// Every known status is listed even at zero, so the shape of the pipeline is
// readable rather than appearing and disappearing as jobs move through it.
// A status that somehow is not in the label map still gets a row.
export function statusBreakdown(jobs) {
  const counts = new Map(Object.keys(STATUS_LABELS).map(key => [key, { count: 0, revenue: 0 }]))

  for (const job of jobs) {
    const key = job.status || 'unknown'
    if (!counts.has(key)) counts.set(key, { count: 0, revenue: 0 })
    const row = counts.get(key)
    row.count += 1
    row.revenue += Number(job.sale_price) || 0
  }

  const total = jobs.length

  return [...counts.entries()].map(([status, row]) => ({
    status,
    label: STATUS_LABELS[status] || status,
    count: row.count,
    revenue: row.revenue,
    share: total === 0 ? 0 : Math.round((row.count / total) * 100),
  }))
}

// Items at or below their reorder threshold, worst shortfall first. Inactive
// items are left out because nobody is going to reorder them.
export function reorderList(stockRows) {
  return stockRows
    .filter(row => row.active !== false && isLowStock(row))
    .map(row => ({ ...row, shortfall: (Number(row.reorder_threshold) || 0) - (Number(row.on_hand) || 0) }))
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
