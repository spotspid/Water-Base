import {
  balanceState, depositsTaken, hasDeposits, isRefund, paidShare,
} from '../src/lib/depositState.js'

// Checks the one judgement deposits make on screen: what a balance means.
//
// Sale price minus deposits is a subtraction that lands on either side of
// zero, and the two sides mean opposite things to whoever reads them. Getting
// it wrong sends an installer to a front door to ask for a negative number, or
// tells him to collect nothing on a job that owes two thousand dollars. That
// is worth a test even though the arithmetic is one line.
//
// Run with: npm run check:deposits
// No database and no browser, so it runs anywhere.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// --- nothing taken, which is a normal state and not a problem ---------------

const untouched = { sale_price: 2999, deposits_taken: 0, deposit_count: 0, balance_due: 2999 }
check('a job with no deposits owes the whole price',
  balanceState(untouched).state === 'due' && balanceState(untouched).amount === 2999)
check('and reports nothing taken', depositsTaken(untouched) === 0)
check('and knows it has none', !hasDeposits(untouched))
check('a job with one has some', hasDeposits({ deposit_count: 1 }))

// --- part paid --------------------------------------------------------------

const part = { sale_price: 2999, deposits_taken: 500, deposit_count: 1, balance_due: 2499 }
check('a part paid job owes the remainder',
  balanceState(part).state === 'due' && balanceState(part).amount === 2499)
check('and remembers what was taken', balanceState(part).taken === 500)
check('and knows the full price', balanceState(part).price === 2999)

// --- paid in full, and the rounding either side of it -----------------------

check('paid to the penny is settled',
  balanceState({ sale_price: 2999, deposits_taken: 2999, balance_due: 0 }).state === 'settled')
check('and reports nothing to collect',
  balanceState({ sale_price: 2999, deposits_taken: 2999, balance_due: 0 }).amount === 0)
check('a third of a cent short is still settled, not a demand for nothing',
  balanceState({ sale_price: 100, deposits_taken: 99.999, balance_due: 0.001 }).state === 'settled')
check('a third of a cent over is still settled, not a refund of nothing',
  balanceState({ sale_price: 100, deposits_taken: 100.001, balance_due: -0.001 }).state === 'settled')
check('a whole cent short is a real balance',
  balanceState({ sale_price: 100, deposits_taken: 99.99, balance_due: 0.01 }).state === 'due')

// --- overpaid, the case that must never print as a negative demand ----------

const over = { sale_price: 2999, deposits_taken: 4100, balance_due: -1101 }
check('an overpaid job is a credit, not a balance', balanceState(over).state === 'credit')
check('and the amount comes back positive, with the sign carried by the state',
  balanceState(over).amount === 1101, String(balanceState(over).amount))
check('so nobody is ever asked to collect a negative',
  balanceState(over).amount > 0)

// --- the derived column wins, but the subtraction is there if it is missing --

check('balance_due from the database is used when present',
  balanceState({ sale_price: 3000, deposits_taken: 500, balance_due: 2499 }).amount === 2499)
check('and the subtraction stands in when the column is not there yet',
  balanceState({ sale_price: 3000, deposits_taken: 500 }).amount === 2500)
check('a missing job does not throw', balanceState(null).state === 'settled')
check('a job with no price and no deposits is settled',
  balanceState({}).state === 'settled')

// A zero price job is a real thing in this book, and asking for nothing is the
// right answer rather than dividing by it.
check('a zero price job is settled',
  balanceState({ sale_price: 0, deposits_taken: 0, balance_due: 0 }).state === 'settled')
check('and has no share to draw', paidShare({ sale_price: 0, deposits_taken: 0 }) === null)
check('a missing price has no share', paidShare({}) === null)

// --- refunds ----------------------------------------------------------------

check('a negative amount is a refund', isRefund({ amount: -250 }))
check('a positive one is not', !isRefund({ amount: 250 }))
check('a missing one is not', !isRefund(null))
check('a refund puts the balance back up',
  balanceState({ sale_price: 3000, deposits_taken: 1500, balance_due: 1500 }).amount === 1500)

// --- the share bar ----------------------------------------------------------

check('half paid is fifty percent',
  Math.abs(paidShare({ sale_price: 3000, deposits_taken: 1500 }) - 50) < 1e-9)
check('nothing paid is zero', paidShare({ sale_price: 3000, deposits_taken: 0 }) === 0)
check('overpaid clamps at a hundred rather than overflowing the bar',
  paidShare({ sale_price: 3000, deposits_taken: 4500 }) === 100)
check('a net refund clamps at zero rather than going backwards',
  paidShare({ sale_price: 3000, deposits_taken: -200 }) === 0)

// --- the scenario the requirement names --------------------------------------

// Sold 2,999, five hundred down in July, installed August. The month figures
// are the database's job, but the job record has to agree with them: 2,499 is
// what the installer collects and what August counts as cash.
const walter = { sale_price: 2999, deposits_taken: 500, deposit_count: 1, balance_due: 2499 }
check('Walter Radu owes 2,499 at the door',
  balanceState(walter).state === 'due' && balanceState(walter).amount === 2499)
check('and 500 plus 2,499 is the sale price exactly once',
  balanceState(walter).taken + balanceState(walter).amount === 2999)

console.log(failed === 0
  ? '\nAll deposit checks passed.'
  : `\n${failed} deposit check(s) failed.`)

process.exit(failed === 0 ? 0 : 1)
