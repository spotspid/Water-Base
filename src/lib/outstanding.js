// What is owed, and in which direction, across every job.
//
// Pure and importing nothing, so the repo check can run it. The database
// decides which state each job is in, in outstanding_balances, so this page
// and a query run by hand cannot disagree about it. This file only names the
// states, orders them, and adds them up.

// Ordered by how soon somebody should act on them.
export const OWED_STATES = [
  {
    key: 'owed_now',
    label: 'Owed now',
    hint: 'Installed, and not paid in full. This is money to chase.',
    direction: 'in',
  },
  {
    key: 'deposit_due',
    label: 'Deposit due',
    hint: 'Not installed, and the deposit agreed at quoting has not all arrived.',
    direction: 'in',
  },
  {
    key: 'on_completion',
    label: 'Due on completion',
    hint: 'Not installed. The rest of the price is due when the work is done, so it is expected, not late.',
    direction: 'in',
  },
  {
    key: 'owed_back',
    label: 'Owed back',
    hint: 'Paid more than the price, or paid on a job that was cancelled. Owed to the customer.',
    direction: 'out',
  },
]

const ORDER = new Map(OWED_STATES.map((s, i) => [s.key, i]))

export function owedStateMeta(key) {
  return OWED_STATES.find(s => s.key === key) || null
}

function money(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Totals per state, plus the two sums a person actually asks for.
 *
 *   collectableNow  owed now plus deposits due: money that should already be in
 *   owedBack        money that should already have gone out
 *
 * Due on completion is kept out of collectableNow on purpose. Counting it
 * would make the figure look like an overdue book when most of it is simply
 * work that has not been done yet.
 */
export function outstandingTotals(rows) {
  const byState = Object.fromEntries(OWED_STATES.map(s => [s.key, { count: 0, amount: 0 }]))

  for (const row of Array.isArray(rows) ? rows : []) {
    const bucket = row && byState[row.owed_state]
    if (!bucket) continue
    bucket.count += 1
    bucket.amount = Math.round((bucket.amount + money(row.amount_owed)) * 100) / 100
  }

  return {
    byState,
    collectableNow: Math.round((byState.owed_now.amount + byState.deposit_due.amount) * 100) / 100,
    owedBack: byState.owed_back.amount,
  }
}

/**
 * Most urgent state first, then the largest amount, then the longest since
 * install, then the name, so the list reads as a to do list.
 */
export function sortOutstanding(rows) {
  return [...(Array.isArray(rows) ? rows : [])].filter(Boolean).sort((a, b) => {
    const ao = ORDER.has(a.owed_state) ? ORDER.get(a.owed_state) : 99
    const bo = ORDER.has(b.owed_state) ? ORDER.get(b.owed_state) : 99
    if (ao !== bo) return ao - bo

    const amount = money(b.amount_owed) - money(a.amount_owed)
    if (Math.abs(amount) > 0.005) return amount

    const days = (Number(b.days_since_install) || 0) - (Number(a.days_since_install) || 0)
    if (days !== 0) return days

    return String(a.customer_name || '').localeCompare(String(b.customer_name || ''), 'en', {
      sensitivity: 'base',
    })
  })
}

/**
 * How long an installed job has owed, in words.
 *
 * Only an installed job has a date the debt started from. Anything else says
 * nothing rather than inventing an age.
 */
export function owedForLabel(days) {
  const n = Number(days)
  if (days === null || days === undefined || !Number.isFinite(n) || n < 0) return ''
  if (n === 0) return 'Installed today'
  if (n === 1) return 'Installed yesterday'
  return `Installed ${n} days ago`
}
