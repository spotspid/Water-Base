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
// the four values are the difference between a figure and a guess.
export const ACTUAL = 'actual'
export const EXPECTED = 'expected'
export const PARTIAL = 'partial'
export const NONE = 'none'

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

/**
 * Totals across a set of jobs, split by what each figure rests on.
 *
 * Kept apart rather than summed into one number, because adding a settled
 * figure to an estimate produces a third thing that is neither, and that is
 * how the 30,080 arose in the first place.
 *
 * uncosted counts the jobs contributing nothing, so the summary can say how
 * much of the picture is missing instead of implying there is none.
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
  }

  for (const job of jobs || []) {
    const basis = job?.parts_cost_basis || NONE
    const profit = Number(job?.margin)
    const parts = Number(job?.parts_cost_effective)

    out.revenue += Number(job?.sale_price) || 0
    out.pay += Number(job?.installer_pay) || 0
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
