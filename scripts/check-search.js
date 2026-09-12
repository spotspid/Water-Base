import { matchesJob, searchJobs } from '../src/lib/search.js'
import { outstandingOf, isOutstanding, filterOutstanding, countOutstanding } from '../src/lib/orderLines.js'

// Checks the two filters added in the usability pass: finding a job by typing
// part of it, and seeing only what an order still owes.
//
// Matching rules are the kind of thing that looks obviously right and quietly
// is not. An invoice number written "MWP 005" on one job and "MWP-005" on the
// next is the specific case that would make a search look broken to the person
// who typed the number correctly.
//
// Run with: npm run check:search

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const neil = {
  customer_name: 'Neil Toomey',
  address: '1570 Kettle Lake Rd, Kalkaska, MI 49684',
  city: 'Kalkaska',
  invoice_number: 'MWP 005',
}

const walter = {
  customer_name: 'Walter Radu',
  address: '3021 Benstein Rd',
  city: 'Commerce Township',
  invoice_number: 'MWP-0001',
}

const noInvoice = { customer_name: 'John Augustin', address: '860 Oxbow Lake Rd', city: null, invoice_number: null }

// --- the three fields ------------------------------------------------------

check('finds by customer name', matchesJob(neil, 'toomey'))
check('finds by first name too', matchesJob(neil, 'neil'))
check('finds by address', matchesJob(neil, 'kettle'))
check('finds by city', matchesJob(walter, 'commerce'))
check('finds by invoice number', matchesJob(neil, 'mwp 005'))
check('and does not find what is not there', !matchesJob(neil, 'radu'))

// --- case and spacing ------------------------------------------------------

check('case does not matter', matchesJob(neil, 'TOOMEY'))
check('leading and trailing space does not matter', matchesJob(neil, '  toomey  '))
check('a double space between terms does not matter', matchesJob(neil, 'neil    toomey'))

// --- the invoice number written three ways ---------------------------------
//
// The real data has "MWP 005" and "MWP-0001". Somebody typing either without
// the separator is not making a mistake.

check('an invoice number matches without its space', matchesJob(neil, 'mwp005'))
check('and without its hyphen', matchesJob(walter, 'mwp0001'))
check('and with the wrong separator', matchesJob(walter, 'mwp 0001'))
check('a partial invoice number still matches', matchesJob(neil, '005'))
check('but a different number does not', !matchesJob(neil, 'mwp009'), 'MWP 005 vs mwp009')

// --- several terms ---------------------------------------------------------
//
// Terms may land on different fields, because that is how a job is remembered:
// a surname and a street, not one string holding both.

check('two terms may match two different fields', matchesJob(neil, 'toomey kettle'))
check('all terms must match something', !matchesJob(neil, 'toomey benstein'))

// --- the empty and the broken ----------------------------------------------

check('an empty query matches everything', matchesJob(neil, ''))
check('whitespace only matches everything', matchesJob(neil, '   '))
check('a null query matches everything', matchesJob(neil, null))
check('a null job matches nothing', !matchesJob(null, 'toomey'))
check('a job with no invoice number does not throw', !matchesJob(noInvoice, 'mwp'))
check('and is still found by its name', matchesJob(noInvoice, 'augustin'))

// --- the list form ---------------------------------------------------------

const jobs = [neil, walter, noInvoice]

check('searching returns the matches', searchJobs(jobs, 'mwp').length === 2)
check('an empty query returns the same array, not a copy',
  searchJobs(jobs, '') === jobs)
check('a null list does not throw', searchJobs(null, 'x').length === 0)
check('no match is an empty list rather than everything',
  searchJobs(jobs, 'zzzznothing').length === 0)

// --- what an order still owes ----------------------------------------------

const arrived = { quantity_ordered: 4, quantity_received: 4, quantity_outstanding: 0 }
const partly = { quantity_ordered: 4, quantity_received: 1, quantity_outstanding: 3 }
const none = { quantity_ordered: 2, quantity_received: 0, quantity_outstanding: 2 }

check('a line fully received owes nothing', outstandingOf(arrived) === 0)
check('a part delivery owes the rest', outstandingOf(partly) === 3)
check('and is flagged outstanding', isOutstanding(partly) && !isOutstanding(arrived))

// The column arrived in a later migration than the table. Falling back to the
// subtraction stops every line reading as received against an older view.
check('a missing outstanding column falls back to the subtraction',
  outstandingOf({ quantity_ordered: 5, quantity_received: 2 }) === 3)
check('over receiving clamps at zero rather than going negative',
  outstandingOf({ quantity_ordered: 2, quantity_received: 5, quantity_outstanding: -3 }) === 0)
check('a null line does not throw', outstandingOf(null) === 0)

const lines = [arrived, partly, none]

check('the filter keeps only what is owed', filterOutstanding(lines, true).length === 2)
check('and is off by default', filterOutstanding(lines, false) === lines)
check('and counts them', countOutstanding(lines) === 2)
check('an order fully received counts none', countOutstanding([arrived]) === 0)
check('a null list does not throw', countOutstanding(null) === 0)

console.log(failed === 0
  ? '\nAll search checks passed.'
  : `\n${failed} search check(s) failed.`)

process.exit(failed === 0 ? 0 : 1)
