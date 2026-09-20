import {
  DUE, NEEDS_AMOUNT, POSTED,
  hasOutstanding, overheadTotals, recurringProblem, stateLabel, stateTone,
} from '../src/lib/recurring.js'

// Checks the standing monthly overheads.
//
// The rule that matters is that a varying cost never contributes a number
// nobody knows. Ad spend is whatever Meta charged, and the one thing this
// feature must not do is let a month look cheaper than it was because the
// figure was guessed, defaulted, or carried over from last month.
//
// The database enforces the same thing, in the proof block of
// 20260920000000_recurring_overhead.sql. This covers the arithmetic and the
// wording the screen puts on top of it.
//
// Run with: npm run check:recurring

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const posted = { state: POSTED, posted_amount: 49, amount: 49 }
const due = { state: DUE, amount: 120 }
const waiting = { state: NEEDS_AMOUNT, amount: null }

// --- the three states say what they mean -------------------------------------

check('a posted cost reads as posted', stateLabel(posted) === 'Posted')
check('a fixed cost waiting on a press reads as ready', stateLabel(due) === 'Ready to post')
check('a varying cost asks for the figure rather than reading as an error',
  stateLabel(waiting).includes('amount') && !/error|missing|fail/i.test(stateLabel(waiting)),
  stateLabel(waiting))
check('and carries the same tone the checklist uses for an unanswered question',
  stateTone(waiting) === 'attention')
check('a posted cost is not asking for anything', stateTone(posted) === 'good')
check('an unknown state does not crash', stateLabel({}) === 'Unknown' && stateLabel(null) === 'Unknown')

// --- the arithmetic ----------------------------------------------------------

const month = [posted, due, waiting]
const t = overheadTotals(month)

check('posted sums what is actually in the books', t.posted === 49, String(t.posted))
check('ready to post sums the fixed costs not yet in', t.readyToPost === 120, String(t.readyToPost))
check('a varying cost is counted, never totalled', t.unknownCount === 1 && t.count === 3)
check('a varying cost adds nothing to either figure',
  overheadTotals([waiting]).posted === 0 && overheadTotals([waiting]).readyToPost === 0)

// The whole point. A month with ad spend outstanding is not a settled month,
// however tidy the fixed costs look.
check('a month with a figure outstanding is not settled', hasOutstanding(month))
check('and a month with everything posted is', !hasOutstanding([posted, { ...posted }]))
check('a fixed cost still to post leaves the month unsettled', hasOutstanding([posted, due]))
check('no costs at all is settled, not outstanding', !hasOutstanding([]))
check('rubbish in does not throw',
  overheadTotals(null).count === 0 && overheadTotals(undefined).posted === 0
  && !hasOutstanding(null))
check('a posted row with no amount counts as zero rather than NaN',
  overheadTotals([{ state: POSTED, posted_amount: null }]).posted === 0)

// --- what the form refuses ---------------------------------------------------

const ok = { vendor: 'Meta', category: 'Advertising', amount_varies: true, day_of_month: '3' }

check('a varying cost needs no amount', recurringProblem(ok) === '', recurringProblem(ok))
check('a fixed cost does',
  recurringProblem({ ...ok, amount_varies: false, amount: '' })
    === 'Enter the monthly amount, or tick that it varies.')
check('a fixed cost of zero is refused',
  recurringProblem({ ...ok, amount_varies: false, amount: '0' }) !== '')
check('a negative amount is refused',
  recurringProblem({ ...ok, amount_varies: false, amount: '-5' }) !== '')
check('an amount typed with a dollar sign and commas is accepted',
  recurringProblem({ ...ok, amount_varies: false, amount: '$1,299.00' }) === '')
check('a blank vendor is refused', recurringProblem({ ...ok, vendor: '  ' }) === 'Enter who it is paid to.')
check('a blank category is refused', recurringProblem({ ...ok, category: '' }) === 'Pick a category.')

// A cost billed on the 31st would skip February, and a cost that skips a
// month under-reports once a year with nothing on screen to say so.
check('the 31st is refused', recurringProblem({ ...ok, day_of_month: '31' }).includes('1 to 28'))
check('the 29th is refused too, because February', recurringProblem({ ...ok, day_of_month: '29' }) !== '')
check('the 28th is fine', recurringProblem({ ...ok, day_of_month: '28' }) === '')
check('the 1st is fine', recurringProblem({ ...ok, day_of_month: '1' }) === '')
check('day zero is refused', recurringProblem({ ...ok, day_of_month: '0' }) !== '')
check('a fractional day is refused', recurringProblem({ ...ok, day_of_month: '5.5' }) !== '')
check('and the refusal explains why rather than just saying invalid',
  recurringProblem({ ...ok, day_of_month: '31' }).includes('February'))

console.log('')
if (failed > 0) {
  console.log(`${failed} recurring check(s) failed.`)
  process.exit(1)
}
console.log('All recurring checks passed.')
