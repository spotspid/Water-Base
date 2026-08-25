import {
  OPEN_STATUSES, arrivalState, entryState, isOpenOrder, landedUplift,
  orderStatusLabel, orderStatusTone,
} from '../src/lib/orderState.js'

// Checks the three judgements a supplier order makes on screen.
//
// Whether a shortage has a date, which is the entire point of the feature: a
// part with nothing free and a delivery on the 14th has to read differently
// from one with nothing free and nothing coming, and a supplier who has
// already missed the date has to read differently again.
//
// Whether the lines add up to the invoice, which is the only check that
// catches a line nobody typed before the stock arrives at the wrong cost.
//
// Whether an order is still counting toward incoming stock, which has to agree
// exactly with the SQL that computes the on order figure.
//
// Run with: npm run check:orders
// No database and no browser, so it runs anywhere.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// --- open or not, which must match the SQL exactly --------------------------

// inventory_stock counts an order toward on_order when its status is in
// ('ordered', 'partial'). If this list drifted, the page would promise stock
// the database was not counting.
check('the open statuses are ordered and partial',
  OPEN_STATUSES.join(',') === 'ordered,partial', OPEN_STATUSES.join(','))
check('an ordered order is still coming', isOpenOrder({ status: 'ordered' }))
check('a part delivered order is still coming', isOpenOrder({ status: 'partial' }))
check('a received order is not', !isOpenOrder({ status: 'received' }))
check('a cancelled order is not', !isOpenOrder({ status: 'cancelled' }))
check('an unknown status is not', !isOpenOrder({ status: 'nonsense' }))
check('a missing order is not', !isOpenOrder(null))

check('part delivered is spelled in plain language',
  orderStatusLabel({ status: 'partial' }) === 'Part delivered')
check('an unknown status still renders something',
  orderStatusLabel({ status: 'weird' }) === 'weird')
check('received reads as good', orderStatusTone({ status: 'received' }) === 'good')
check('cancelled is not an alarm', orderStatusTone({ status: 'cancelled' }) === 'neutral')

// --- the arrival date, the reason this feature exists -----------------------

const NOW = new Date(2026, 8, 10) // 10 September 2026, local

check('nothing on order is not a date',
  arrivalState({ on_order: 0, expected_arrival: '2026-09-14' }, NOW).state === 'none')
check('a missing row is not a date', arrivalState(null, NOW).state === 'none')
check('on order with no date says so',
  arrivalState({ on_order: 4, expected_arrival: null }, NOW).state === 'undated')
check('a date in the future is an answer',
  arrivalState({ on_order: 4, expected_arrival: '2026-09-14' }, NOW).state === 'expected')
check('today is its own case',
  arrivalState({ on_order: 4, expected_arrival: '2026-09-10' }, NOW).state === 'today')
check('a date that has gone by is overdue, not an answer',
  arrivalState({ on_order: 4, expected_arrival: '2026-09-09' }, NOW).state === 'overdue')
check('the quantity comes back with it',
  arrivalState({ on_order: 4, expected_arrival: '2026-09-14' }, NOW).onOrder === 4)
check('a timestamp is truncated to its day',
  arrivalState({ on_order: 1, expected_arrival: '2026-09-14T00:00:00+00:00' }, NOW).date === '2026-09-14')

// The date is compared as a string against today rendered the same way. Parsing
// it into a Date would drag it through UTC and move it a day, which is how
// "arrives today" silently becomes "overdue" for anyone west of Greenwich.
check('a month boundary does not slip',
  arrivalState({ on_order: 1, expected_arrival: '2026-10-01' }, new Date(2026, 8, 30)).state === 'expected')
check('a year boundary does not slip',
  arrivalState({ on_order: 1, expected_arrival: '2027-01-02' }, new Date(2026, 11, 31)).state === 'expected')
check('yesterday across a month boundary is overdue',
  arrivalState({ on_order: 1, expected_arrival: '2026-08-31' }, new Date(2026, 8, 1)).state === 'overdue')

// --- does the entry add up --------------------------------------------------

check('no invoice total means nothing to check against',
  entryState({ invoice_total: null }).known === false)
check('a zero balance is balanced',
  entryState({ invoice_total: 100, entry_balance: 0 }).balanced === true)
check('a penny out is not balanced',
  entryState({ invoice_total: 100, entry_balance: 0.01 }).balanced === false)
check('rounding dust still counts as balanced',
  entryState({ invoice_total: 100, entry_balance: 0.004 }).balanced === true)
check('a missing line leaves a positive balance',
  entryState({ invoice_total: 10561.05, entry_balance: 9803 }).remaining === 9803)
check('typing a line twice leaves a negative one',
  entryState({ invoice_total: 100, entry_balance: -25 }).remaining === -25)

// QB-20104 as it stands today: header entered, no lines yet.
const QB = { invoice_total: 10561.05, entry_balance: 9803.00 }
check('QB-20104 says 9,803.00 of the invoice is still untyped',
  entryState(QB).remaining === 9803 && !entryState(QB).balanced)

// --- the freight uplift -----------------------------------------------------

check('no lines means no rate to show', landedUplift({ subtotal: 0, freight_amount: 100 }) === null)
check('no freight is a rate of zero',
  landedUplift({ subtotal: 1000, freight_amount: 0, tax_amount: 0 }) === 0)
check('freight and tax are both in the rate',
  Math.abs(landedUplift({ subtotal: 1000, freight_amount: 75, tax_amount: 25 }) - 10) < 1e-9)

// Invoice 5831, reconstructed. Dividing its landed costs by one rate gives
// 450.00, 225.00 and 22.50, so the hand entry was a uniform percentage uplift,
// which is what allocating by extended cost produces.
const rate5831 = landedUplift({ subtotal: 5180.63, freight_amount: 401.90, tax_amount: 0 })
check('5831 reconstructs to about 7.76 percent',
  Math.abs(rate5831 - 7.7578) < 0.001, rate5831.toFixed(4))
check('and puts a 450.00 part at 484.91',
  Math.round(450 * (1 + rate5831 / 100) * 100) / 100 === 484.91)
check('and a 225.00 part at 242.45',
  Math.round(225 * (1 + rate5831 / 100) * 100) / 100 === 242.45)
check('and a 22.50 faucet at 24.25',
  Math.round(22.5 * (1 + rate5831 / 100) * 100) / 100 === 24.25)

// QB-20104: 10,561.05 with 758.05 shipping leaves 9,803.00 of lines.
const rateQB = landedUplift({ subtotal: 9803.00, freight_amount: 758.05, tax_amount: 0 })
check('QB-20104 lands at about 7.73 percent once its lines are in',
  Math.abs(rateQB - 7.7328) < 0.001, rateQB.toFixed(4))

console.log(failed === 0
  ? '\nAll supplier order checks passed.'
  : `\n${failed} supplier order check(s) failed.`)

process.exit(failed === 0 ? 0 : 1)
