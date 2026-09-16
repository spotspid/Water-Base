import {
  OWED_STATES, outstandingTotals, owedForLabel, owedStateMeta, sortOutstanding,
} from '../src/lib/outstanding.js'

// Checks how the outstanding list adds up and orders.
//
// The database decides which state a job is in. What is worth a test here is
// the one judgement this page adds: what "collectable now" means. Counting
// money due on completion as collectable would make a healthy book of booked
// work look like a stack of unpaid invoices.
//
// Run with: npm run check:outstanding
// No database and no browser, so it runs anywhere.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// --- the states ---------------------------------------------------------------

check('four states', OWED_STATES.length === 4)
check('owed now comes first', OWED_STATES[0].key === 'owed_now')
check('owed back is money going out', owedStateMeta('owed_back')?.direction === 'out')
check('an unknown state has no meaning', owedStateMeta('nonsense') === null)

// --- the book as it stands today ----------------------------------------------

const today = [
  { customer_name: 'Walter Radu', owed_state: 'owed_now', amount_owed: 2999, days_since_install: 28 },
  { customer_name: 'Neil Toomey', owed_state: 'on_completion', amount_owed: 6999 },
  { customer_name: 'Ashley Fox', owed_state: 'on_completion', amount_owed: 2999 },
]

const totals = outstandingTotals(today)
check('Walter Radu is money owed now', totals.byState.owed_now.amount === 2999)
check('and is collectable now', totals.collectableNow === 2999, String(totals.collectableNow))
check('work not yet done is not counted as collectable',
  totals.byState.on_completion.amount === 9998 && totals.collectableNow === 2999)
check('nothing is owed back', totals.owedBack === 0)

// --- a deposit agreed and not paid ---------------------------------------------

const withDeposit = outstandingTotals([
  ...today,
  { customer_name: 'David Camaj', owed_state: 'deposit_due', amount_owed: 1139.7 },
])
check('a deposit due is collectable now',
  withDeposit.collectableNow === 4138.7, String(withDeposit.collectableNow))

// --- money going back ----------------------------------------------------------

const refund = outstandingTotals([
  { customer_name: 'Cancelled', owed_state: 'owed_back', amount_owed: 500 },
  { customer_name: 'Overpaid', owed_state: 'owed_back', amount_owed: 12.5 },
])
check('owed back is summed', refund.owedBack === 512.5)
check('and never reduces what is collectable', refund.collectableNow === 0)

// --- rubbish in -----------------------------------------------------------------

check('nothing totals to nothing', outstandingTotals(null).collectableNow === 0)
check('an unknown state is ignored rather than miscounted',
  outstandingTotals([{ owed_state: 'nonsense', amount_owed: 100 }]).collectableNow === 0)
check('a missing amount counts as zero',
  outstandingTotals([{ owed_state: 'owed_now' }]).byState.owed_now.count === 1)

// --- ordering -------------------------------------------------------------------

const ordered = sortOutstanding([
  { customer_name: 'B', owed_state: 'on_completion', amount_owed: 9000 },
  { customer_name: 'A', owed_state: 'owed_now', amount_owed: 100, days_since_install: 5 },
  { customer_name: 'C', owed_state: 'owed_now', amount_owed: 100, days_since_install: 40 },
  { customer_name: 'D', owed_state: 'deposit_due', amount_owed: 500 },
])
check('owed now leads, whatever the amounts',
  ordered[0].owed_state === 'owed_now' && ordered[1].owed_state === 'owed_now')
check('a tie on amount goes to the longest owed', ordered[0].customer_name === 'C')
check('deposits due before work not yet done', ordered[2].owed_state === 'deposit_due')
check('ordering nothing is nothing', sortOutstanding(undefined).length === 0)

// --- words ----------------------------------------------------------------------

check('installed today', owedForLabel(0) === 'Installed today')
check('one day is yesterday', owedForLabel(1) === 'Installed yesterday')
check('many days', owedForLabel(28) === 'Installed 28 days ago')
check('no install date says nothing', owedForLabel(null) === '')
check('a negative age says nothing rather than something impossible', owedForLabel(-2) === '')

console.log('')
if (failed > 0) {
  console.error(`${failed} outstanding check(s) failed.`)
  process.exit(1)
}
console.log('All outstanding checks passed.')
