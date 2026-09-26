import { COST_UNSET, formatCost, hasCost, unpricedRows } from '../src/lib/inventory.js'
import { costEffect, groupActivity, inventoryValue } from '../src/lib/dashboard.js'
import { warrantyTotals } from '../src/lib/warranty.js'
import { templateCost } from '../src/lib/templates.js'

// A part nobody has priced is not a part that costs nothing.
//
// inventory_items.unit_cost used to be not null with a default of zero, so
// there was no way to say "we do not know yet". Every figure built on it then
// treated the part as free: the shelf value, the template cost, the job
// costing, the warranty bill. A $300 tank entered without a cost was $300 of
// invented profit on every job that used it, and nothing anywhere said so.
//
// Null now means nobody has recorded it and zero means genuinely free, which
// two control valves really are: they arrive inside the landed cost of the
// system. This file is the rule that the first never quietly becomes the
// second.
//
// Run with: npm run check:cost

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// --- knowing the difference ------------------------------------------------

check('a cost of zero is known', hasCost(0))
check('and prints as money', formatCost(0) === '$0.00', formatCost(0))
check('no cost recorded is not known', !hasCost(null) && !hasCost(undefined) && !hasCost(''))
check('and prints as a word', formatCost(null) === COST_UNSET, formatCost(null))
check('rubbish is not a cost either', !hasCost('ask Steve'))

// --- the shelf -------------------------------------------------------------

const stock = [
  { sku: 'SALT-40', unit_cost: 6.5, on_hand: 20, stock_value: 130 },
  { sku: 'VLV-CLACK', unit_cost: 0, on_hand: 5, stock_value: 0 },
  { sku: 'TANK-NEW', unit_cost: null, on_hand: 3, stock_value: null },
]

check('an unpriced part is found', unpricedRows(stock).length === 1,
  unpricedRows(stock).map(r => r.sku).join(', '))
check('a deliberately free part is not', !unpricedRows(stock).some(r => r.sku === 'VLV-CLACK'))
check('value on hand leaves the unpriced part out rather than valuing it at nothing',
  inventoryValue(stock) === 130, String(inventoryValue(stock)))

// --- the ledger ------------------------------------------------------------

check('a movement with no stamped cost has no cost effect',
  costEffect({ quantity: -1, unit_cost_at_txn: null }) === null)
check('one with a stamp does', costEffect({ quantity: -2, unit_cost_at_txn: 6.5 }) === -13)
check('and a stamped zero is still zero, not unknown',
  costEffect({ quantity: -1, unit_cost_at_txn: 0 }) === 0)

const grouped = groupActivity([
  { id: 'a', job_id: 'j1', deduct_batch: 1, quantity: -1, unit_cost_at_txn: 100 },
  { id: 'b', job_id: 'j1', deduct_batch: 1, quantity: -1, unit_cost_at_txn: null },
])
check('a group sums what it knows', grouped[0].value === -100, String(grouped[0].value))
check('and counts what it does not', grouped[0].uncosted === 1)

// --- the warranty bill -----------------------------------------------------

const warranty = warrantyTotals([
  { units: 1, cost: 220, sku: 'RO-4STAGE', supplier: 'Watts' },
  { units: 1, cost: null, sku: 'TANK-NEW', supplier: 'Unknown' },
])
check('warranty cost sums what is known', warranty.cost === 220, String(warranty.cost))
check('and says how many replacements it could not cost', warranty.uncosted === 1)
check('while the failure count still counts them all', warranty.events === 2 && warranty.units === 2)

// --- a build sheet ---------------------------------------------------------

const items = [
  { id: 'i1', category: 'Faucet', variant: 'Chrome', unit_cost: 40, active: true },
  { id: 'i2', category: 'Faucet', variant: 'Nickel', unit_cost: null, active: true },
]

const withUnpriced = templateCost([
  { line_type: 'fixed', quantity: 1, unit_cost: 300 },
  { line_type: 'fixed', quantity: 2, unit_cost: null },
], items)

check('a build sheet leaves an unpriced line out of its cost',
  withUnpriced.low === 300 && withUnpriced.high === 300, String(withUnpriced.low))
check('and counts it so the card can say the figure is a floor',
  withUnpriced.uncostedLines === 1)

const pickRange = templateCost([
  { line_type: 'customer_pick', pick_category: 'Faucet', quantity: 1 },
], items)

check('a customer pick ranges over the options it can cost',
  pickRange.low === 40 && pickRange.high === 40, `${pickRange.low} to ${pickRange.high}`)
check('and says one of its options has no cost', pickRange.uncostedLines === 1)

const allPriced = templateCost([{ line_type: 'fixed', quantity: 1, unit_cost: 0 }], items)
check('a genuinely free line is costed, not flagged',
  allPriced.uncostedLines === 0 && allPriced.low === 0)

console.log(failed === 0
  ? '\nAll cost checks passed.'
  : `\n${failed} cost check(s) failed.`)

process.exit(failed === 0 ? 0 : 1)
