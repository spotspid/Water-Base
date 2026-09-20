// The standing monthly overheads, as the screen reads them.
//
// Pure and importing nothing, so npm run check can run it under Node. The
// database owns the rules; this only puts words to the three states the view
// reports so the panel and the check agree on what each one means.

export const POSTED = 'posted'
export const NEEDS_AMOUNT = 'needs_amount'
export const DUE = 'due'

/**
 * What the panel says about one standing cost this month.
 *
 * A varying cost with no figure is not an error and not a warning, it is a
 * job somebody has to do: read the real number off the platform. The wording
 * says that rather than "missing", which reads like a fault in the app.
 */
export function stateLabel(row) {
  switch (row?.state) {
    case POSTED: return 'Posted'
    case NEEDS_AMOUNT: return 'Needs this month’s amount'
    case DUE: return 'Ready to post'
    default: return 'Unknown'
  }
}

export function stateTone(row) {
  switch (row?.state) {
    case POSTED: return 'good'
    case NEEDS_AMOUNT: return 'attention'
    default: return 'ready'
  }
}

/**
 * The month's overhead, split into what is in the books and what is not.
 *
 * missing is what the P&L is currently missing, which is the number worth
 * showing: a month that looks profitable because nobody entered Meta yet is
 * the exact error this whole feature exists to stop. A varying cost
 * contributes nothing to it, because nobody knows what it is yet, and saying
 * zero would be the same lie in a smaller font.
 */
export function overheadTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  let posted = 0
  let readyToPost = 0
  let unknownCount = 0

  for (const row of list) {
    if (row?.state === POSTED) posted += Number(row.posted_amount) || 0
    else if (row?.state === DUE) readyToPost += Number(row.amount) || 0
    else if (row?.state === NEEDS_AMOUNT) unknownCount += 1
  }

  return { posted, readyToPost, unknownCount, count: list.length }
}

/**
 * Whether anything at all is outstanding, which is what decides if the panel
 * asks for attention or sits quiet.
 */
export function hasOutstanding(rows) {
  const { readyToPost, unknownCount } = overheadTotals(rows)
  return readyToPost > 0 || unknownCount > 0
}

/**
 * What is wrong with a standing cost as typed, or an empty string.
 *
 * Mirrors the table's constraints so the form refuses in words before the
 * database refuses in Postgres. The day rule is the one worth explaining: a
 * cost billed on the 31st would skip February, and a cost that skips a month
 * under-reports once a year without anybody noticing.
 */
export function recurringProblem(form) {
  const f = form || {}
  if (String(f.vendor ?? '').trim() === '') return 'Enter who it is paid to.'
  if (String(f.category ?? '').trim() === '') return 'Pick a category.'

  const day = Number(String(f.day_of_month ?? '').trim())
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    return 'Billing day must be 1 to 28, so the cost lands in every month including February.'
  }

  if (!f.amount_varies) {
    const raw = String(f.amount ?? '').trim()
    if (raw === '') return 'Enter the monthly amount, or tick that it varies.'
    const n = Number(raw.replace(/[$,\s]/g, ''))
    if (!Number.isFinite(n) || n <= 0) return 'The monthly amount must be more than zero.'
  }

  return ''
}
