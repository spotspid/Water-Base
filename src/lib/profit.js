// One word for profit, and one place that decides what a parts figure means.
//
// Jobs said "Margin so far" and Profit and loss said "Net". Two numbers, two
// words, sixteen times apart, two clicks from each other, and nothing on
// either screen said they were measuring different things. A reader comparing
// them was not being careless; they were being invited.
//
// The word is profit on both pages now, and the scope is the qualifier:
//
//   Gross profit   price less parts less installer pay.
//   Net profit     gross profit less overheads.
//
// They still differ, and they still should. What changed is that the
// difference is written down rather than left as a trap.
//
// Pure and importing nothing, so npm run check can run it under Node. The
// wording is the feature here, which is exactly the kind of thing that should
// be tested rather than eyeballed.

export const GROSS = 'Gross profit'
export const NET = 'Net profit'

// What a parts figure is standing on. Mirrors job_margin.parts_cost_basis, and
// the values are the difference between a figure and a guess.
//
// UNPRICED and NO_PAY are the two blanks that used to be counted as zero. A
// part nobody has priced was costed as free, and a job with no payout was
// costed as though the crew worked for nothing. Both are reasons a profit
// figure cannot be shown, which is what they now say.
//
// NO_PAY only ever arrives on profit_basis, never on parts_cost_basis: the pay
// has nothing to do with what the parts cost.
export const ACTUAL = 'actual'
export const EXPECTED = 'expected'
export const PARTIAL = 'partial'
export const NONE = 'none'
export const UNPRICED = 'unpriced'
export const NO_PAY = 'no_pay'

const BASIS = {
  [ACTUAL]: {
    short: 'actual',
    parts: 'Deducted from the shelf when it installed, at the cost stamped on each row.',
    profit: 'Actual. This job installed and its parts are in the ledger, so this figure '
      + 'will not move again.',
  },
  [EXPECTED]: {
    short: 'expected',
    parts: 'Expected, from the parts list on this job at today’s item costs. '
      + 'Nothing has left the shelf yet.',
    profit: 'Expected. Its parts list resolves in full, so this is what it makes if '
      + 'nothing changes before it installs.',
  },
  [PARTIAL]: {
    short: 'incomplete',
    parts: 'At least this much. Some lines on its parts list cannot name a part yet, '
      + 'so they are not counted here.',
    profit: 'Not costed yet. Some lines on its parts list cannot name a part, so any '
      + 'profit figure would be too high.',
  },
  [NONE]: {
    short: 'not costed',
    parts: 'Nothing is listed against this job, so it has no cost to report. '
      + 'That is not the same as costing nothing.',
    profit: 'Not costed yet. This job has no parts list at all, so there is nothing to '
      + 'subtract from its price.',
  },
  [UNPRICED]: {
    short: 'part has no cost',
    parts: 'At least this much. A part on this job has no cost recorded against it, '
      + 'so it adds nothing here. Price it on the inventory page and this figure rises.',
    profit: 'Not costed yet. A part on this job has no cost recorded, so it would be '
      + 'counted as free and the profit would read too high.',
  },
  [NO_PAY]: {
    short: 'pay not set',
    parts: 'The parts on this job are costed. The profit is not, because the installer '
      + 'pay is missing.',
    profit: 'Not costed yet. No installer pay is recorded on this job, and counting it '
      + 'as nothing would show a profit the crew has not been paid out of.',
  },
}

function meta(basis) {
  return BASIS[basis] || BASIS[NONE]
}

/**
 * Whether a profit figure from this basis can be shown as a number.
 *
 * Only actual and expected. The other two would put an overstatement on screen
 * in the same typeface as a real figure, which is the fault this exists to
 * stop.
 */
export function canShowProfit(basis) {
  return basis === ACTUAL || basis === EXPECTED
}

// The one word beside a figure saying what it rests on, or an empty string for
// an installed job, where "actual" is the default and labelling it would add
// noise to every settled row.
export function basisTag(basis) {
  return basis === ACTUAL ? '' : meta(basis).short
}

export function partsNote(basis) {
  return meta(basis).parts
}

export function profitNote(basis) {
  return meta(basis).profit
}

// What to print where a profit figure would go when there is none.
export const NOT_COSTED = 'Not costed yet'

// And what to print where a payout would go when nobody has entered one. Not
// $0.00, which is a payout somebody decided on, and which this app has never
// once meant.
export const PAY_UNSET = 'Not set'

/**
 * The reason a profit figure is missing, worded for the cell it sits in.
 *
 * Long enough to act on, short enough for a table: a missing payout is one
 * field on this job, and saying so beats a general "not costed yet".
 */
export function notCostedLabel(basis) {
  return basis === NO_PAY ? 'Pay not set' : NOT_COSTED
}

// Whether a money figure came from somebody rather than from a blank. Used
// wherever a payout or a unit cost is printed, because both can be legitimately
// zero and neither can be legitimately guessed.
export function isKnownAmount(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

/**
 * Totals across a set of jobs, split by what each figure rests on.
 *
 * Kept apart rather than summed into one number, because adding a settled
 * figure to an estimate produces a third thing that is neither, and that is
 * how the 30,080 arose in the first place.
 *
 * uncosted counts the jobs contributing nothing, so the summary can say how
 * much of the picture is missing instead of implying there is none.
 *
 * payUnknown counts the jobs with no payout recorded. Their pay is left out of
 * the total rather than added as zero, which is the same rule the parts side
 * has followed since this file existed.
 */
export function profitTotals(jobs) {
  const out = {
    revenue: 0,
    parts: 0,
    pay: 0,
    actual: 0,
    expected: 0,
    actualJobs: 0,
    expectedJobs: 0,
    uncosted: 0,
    payUnknown: 0,
    partsUnpriced: 0,
  }

  for (const job of jobs || []) {
    // profit_basis carries the parts reasons and the missing payout. Older
    // callers passing only a parts basis still work, and read the same.
    const basis = job?.profit_basis || job?.parts_cost_basis || NONE
    const profit = Number(job?.margin)
    const parts = Number(job?.parts_cost_effective)

    out.revenue += Number(job?.sale_price) || 0

    if (isKnownAmount(job?.installer_pay)) {
      out.pay += Number(job.installer_pay)
    } else {
      out.payUnknown += 1
    }

    if (Number(job?.uncosted_parts_lines) > 0) out.partsUnpriced += 1
    if (Number.isFinite(parts)) out.parts += parts

    if (!Number.isFinite(profit) || !canShowProfit(basis)) {
      out.uncosted += 1
      continue
    }

    if (basis === ACTUAL) {
      out.actual += profit
      out.actualJobs += 1
    } else {
      out.expected += profit
      out.expectedJobs += 1
    }
  }

  out.combined = out.actual + out.expected

  return out
}

/**
 * The sentence under the gross profit figure on the jobs page.
 *
 * Says what the number is made of, because a total mixing settled and expected
 * work is only honest if it admits the mix.
 */
export function totalsNote(totals) {
  if (!totals || (totals.actualJobs === 0 && totals.expectedJobs === 0)) {
    return 'No job has a parts figure yet, so there is nothing to total.'
  }

  const parts = []

  if (totals.actualJobs > 0) {
    parts.push(`${totals.actualJobs} installed`)
  }

  if (totals.expectedJobs > 0) {
    parts.push(`${totals.expectedJobs} expected`)
  }

  const tail = totals.uncosted > 0
    ? `. ${totals.uncosted} ${totals.uncosted === 1 ? 'job is' : 'jobs are'} not costed yet and `
      + 'add nothing.'
    : '.'

  return `${parts.join(', ')}${tail}`
}

/**
 * The sentence under the installer pay figure.
 *
 * A total that leaves jobs out has to say so, or it reads as the whole wage
 * bill. Silent when every job has a payout, which is the state to aim at.
 */
export function payNote(totals) {
  const missing = totals?.payUnknown || 0

  if (missing === 0) return 'Recorded on every job here'

  return `${missing} ${missing === 1 ? 'job has' : 'jobs have'} no payout recorded and `
    + `${missing === 1 ? 'is' : 'are'} left out`
}

/**
 * The sentence under the parts figure, when a part on one of these jobs has no
 * cost recorded. Empty otherwise, so the tile keeps its usual note.
 */
export function partsUnpricedNote(totals) {
  const missing = totals?.partsUnpriced || 0

  if (missing === 0) return ''

  return `${missing} ${missing === 1 ? 'job has a part' : 'jobs have parts'} with no cost recorded`
}
