import {
  failureRate, isWarranty, rateLabel, serviceLabel, warrantyTotals, worstFirst,
} from '../src/lib/warranty.js'

// Checks how a warranty failure reads on screen.
//
// The database counts. This decides what a count means, and the two mistakes
// worth a test are a rate with no base printed as a confident zero, and a
// part that failed the day it went in printed as a negative age.
//
// Run with: npm run check:warranty
// No database and no browser, so it runs anywhere.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// --- the type ---------------------------------------------------------------

check('warranty is the warranty type', isWarranty('warranty'))
check('damage is not', !isWarranty('damage'))
check('nothing is not', !isWarranty(null) && !isWarranty(''))

// --- the rate ---------------------------------------------------------------

check('two failures in forty installs is five percent', failureRate(2, 40) === 5)
check('rounded to a tenth', failureRate(1, 3) === 33.3, String(failureRate(1, 3)))
check('no installs is no rate, not zero', failureRate(2, 0) === null)
check('nor is a missing base', failureRate(2, undefined) === null)
check('no failures against installs is a real zero', failureRate(0, 12) === 0)
check('rubbish in is no rate', failureRate('x', 'y') === null)

check('a rate prints with one decimal', rateLabel(5) === '5.0%')
check('a real zero prints as zero', rateLabel(0) === '0.0%')
check('no rate says so rather than printing zero',
  rateLabel(null) === 'No base to measure against')
check('and so does a string that is not a number', rateLabel('n/a') === 'No base to measure against')

// --- time in service --------------------------------------------------------

check('unknown install date says so', serviceLabel(null) === 'Install date unknown')
check('failed the day it went in is same day', serviceLabel(0) === 'Same day')
check('one day is singular', serviceLabel(1) === '1 day in service')
check('under two months reads in days', serviceLabel(45) === '45 days in service')
check('over two months reads in months', serviceLabel(412) === '14 months in service')
check('sixty one days is two months, never one',
  serviceLabel(61) === '2 months in service', serviceLabel(61))
check('a failure logged before the install date is flagged, not negative',
  serviceLabel(-3) === 'Before the recorded install date')

// --- totals -----------------------------------------------------------------

const events = [
  { sku: 'MB-1054', units: 1, cost: 716.42, supplier: 'Honest' },
  { sku: 'MB-1054', units: 1, cost: 716.42, supplier: 'Honest' },
  { sku: 'VLV-HEAD', units: 2, cost: 484.8, supplier: 'Unknown' },
  null,
]
const totals = warrantyTotals(events)
check('events are counted', totals.events === 3)
check('units are summed', totals.units === 4)
check('cost is summed to the cent', totals.cost === 1917.64, String(totals.cost))
check('parts are counted once each', totals.skus === 2)
check('unknown is not a supplier', totals.suppliers === 1)
check('nothing totals to nothing', warrantyTotals(undefined).events === 0)

// --- ordering ---------------------------------------------------------------

const ranked = worstFirst([
  { sku: 'B', failures: 1, failure_rate_pct: 2.5 },
  { sku: 'A', failures: 5, failure_rate_pct: null },
  { sku: 'C', failures: 3, failure_rate_pct: 10 },
  { sku: 'D', failures: 4, failure_rate_pct: 10 },
])
check('the worst rate leads', ranked[0].sku === 'D' && ranked[1].sku === 'C', ranked.map(r => r.sku).join())
check('a tie on rate goes to more failures', ranked[0].failures === 4)
check('no rate sorts last however many failures it has', ranked[3].sku === 'A')
check('ordering nothing is nothing', worstFirst(null).length === 0)

console.log('')
if (failed > 0) {
  console.error(`${failed} warranty check(s) failed.`)
  process.exit(1)
}
console.log('All warranty checks passed.')
