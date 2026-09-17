import { CANCELLED_STATUS, QUOTED_STATUS } from './constants.js'
import { daysSinceQuoteSent } from './quotes.js'

// A quote left this long without a signature is a sale going cold.
export const STALE_QUOTE_DAYS = 10

// What is missing or wrong on a job, in words.
//
// Every one of these is a way a job quietly drops out of, or distorts, the
// money. A price of nothing earns nothing on Profit and loss. A parts line that
// names no stock item leaves the job uncosted and refuses the install. Pay left
// blank on booked work counts as zero, so profit reads high. A job with no
// invoice number cannot send its work order. A test row counts as a real sale.
//
// Cancelled jobs are left out. They are out of the money on purpose, and a
// list that kept nagging about them would train people to ignore it.
//
// Reads job_margin rows, so the dashboard and the jobs page ask the same
// question of the same columns: sale_price, parts_cost_basis, unresolved_lines,
// payout_amount, invoice_number, customer_name, status.

const BOOKED = ['scheduled', 'installed']

// A name or an invoice number that says it is not a real customer.
const TEST_NAME = /(^|[^a-z])(zz|test)([^a-z]|$)/i

function blank(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

export function isTestJob(job) {
  return TEST_NAME.test(String(job?.customer_name || ''))
    || /test/i.test(String(job?.invoice_number || ''))
}

/**
 * The reasons a job needs looking at, most costly first. Empty when it is fine.
 */
export function attentionReasons(job, now = new Date()) {
  if (!job || job.status === CANCELLED_STATUS) return []

  const reasons = []
  const price = Number(job.sale_price)
  const unresolved = Number(job.unresolved_lines) || 0
  const pay = Number(job.payout_amount)

  if (isTestJob(job)) reasons.push('Test row, counts as a real sale')

  if (blank(job.sale_price) || !Number.isFinite(price) || price <= 0) {
    reasons.push('No sale price')
  }

  if (job.parts_cost_basis === 'none') {
    reasons.push('No parts listed')
  } else if (unresolved > 0) {
    reasons.push(`${unresolved} parts ${unresolved === 1 ? 'line does' : 'lines do'} not match a stock item`)
  }

  if (BOOKED.includes(job.status) && (blank(job.payout_amount) || !Number.isFinite(pay) || pay <= 0)) {
    reasons.push('Installer pay not set')
  }

  if (blank(job.invoice_number)) reasons.push('No invoice number')

  const quoteAge = job.status === QUOTED_STATUS ? daysSinceQuoteSent(job, now) : null
  if (quoteAge != null && quoteAge >= STALE_QUOTE_DAYS) {
    reasons.push(`Quote unsigned ${quoteAge} days`)
  }

  return reasons
}

export function needsAttention(jobs, now = new Date()) {
  return (jobs || []).filter(job => attentionReasons(job, now).length > 0)
}
