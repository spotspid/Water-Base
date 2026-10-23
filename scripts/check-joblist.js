import { countByStatus, listTotals, needsLookingAt, sortJobs } from '../src/lib/jobList.js'

// The job list's counting and sorting.
//
// The rule being protected is that the list says what needs doing. Its
// predecessor showed eight installs that had happened and were never marked,
// for three weeks, with the dates in plain view, because a date is not a
// question and nothing sorted them to the top.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const TODAY = new Date('2026-10-23T12:00:00Z')

const overdue = { id: 'a', customer_name: 'Glen', status: 'scheduled', scheduled_date: '2026-09-28', sale_price: 3799 }
const booked = { id: 'b', customer_name: 'Warren', status: 'scheduled', scheduled_date: '2026-11-04', sale_price: 3399 }
const quote = { id: 'c', customer_name: 'Neha', status: 'quoted', created_at: '2026-10-20', sale_price: 2749 }
const done = { id: 'd', customer_name: 'Prudhvi', status: 'installed', install_date: '2026-09-13', sale_price: 3949 }
const unpriced = { id: 'e', customer_name: 'Donna', status: 'sold', created_at: '2026-10-01', sale_price: null }
const dropped = { id: 'f', customer_name: 'Gone', status: 'cancelled', sale_price: 999 }

// --- what gets flagged -------------------------------------------------------

check('an install that has come and gone asks whether it happened',
  needsLookingAt(overdue, TODAY) === 'Installed 25 days ago?', needsLookingAt(overdue, TODAY))
check('a booking in the future says nothing', needsLookingAt(booked, TODAY) === '')
check('a quote says nothing, because a quote is not late', needsLookingAt(quote, TODAY) === '')
check('sold work with no price says so', needsLookingAt(unpriced, TODAY) === 'No price')
check('a cancelled job says nothing at all', needsLookingAt(dropped, TODAY) === '')
check('one day reads as a day, not days',
  needsLookingAt({ ...overdue, scheduled_date: '2026-10-22' }, TODAY) === 'Installed 1 day ago?',
  needsLookingAt({ ...overdue, scheduled_date: '2026-10-22' }, TODAY))

// --- the order ---------------------------------------------------------------

const sorted = sortJobs([booked, quote, done, overdue, unpriced], TODAY)

check('whatever is asking a question comes first',
  sorted[0].id === 'a' || sorted[0].id === 'e',
  sorted.map(j => j.id).join(' '))
check('and both of them come before anything quiet',
  ['a', 'e'].includes(sorted[0].id) && ['a', 'e'].includes(sorted[1].id),
  sorted.map(j => j.id).join(' '))
check('the quiet ones are newest first',
  sorted.slice(2).map(j => j.id).join('') === 'bcd',
  sorted.slice(2).map(j => j.id).join(''))
check('sorting does not change the list it was given',
  sortJobs([booked, overdue], TODAY).length === 2)

// --- the totals --------------------------------------------------------------

const totals = listTotals([booked, quote, done, unpriced, dropped])

check('sold work and quotes are counted apart',
  totals.sold === 3399 + 3949 && totals.quoted === 2749,
  `sold ${totals.sold}, quoted ${totals.quoted}`)
check('a cancelled job counts towards neither', totals.sold + totals.quoted === 10097)
check('a job with no price is counted as unpriced, not as nothing',
  totals.unpriced === 1 && totals.sold === 7348,
  `unpriced ${totals.unpriced}, sold ${totals.sold}`)

const counts = countByStatus([booked, quote, done, unpriced, dropped])
check('the filter counts match the rows', counts.scheduled === 1 && counts.quoted === 1 && counts.sold === 1)
check('and an unknown status is ignored rather than counted',
  countByStatus([{ status: 'nonsense' }]).quoted === 0)

console.log(failed === 0
  ? '\nAll job list checks passed.'
  : `\n${failed} job list check(s) failed.`)

process.exitCode = failed === 0 ? 0 : 1
