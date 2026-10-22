import { quoteLines, whatIsMissing, canSend, money } from '../src/lib/quote.js'

// The quoting page's arithmetic, checked without a browser.
//
// The rule being protected is that a price nobody has set is not a price of
// zero. Two of the six presets have no price today, Filtration Only and
// Custom, and treating a blank as nought would quote a whole home system at
// the cost of its extras. That is the same fault as counting an unknown
// installer payout as free labour, which was the most expensive thing on the
// known issues list.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const FLAGSHIP = { id: 'a', name: 'Flagship Bundle', price: 2999 }
const CUSTOM = { id: 'b', name: 'Custom', price: null }
const REROUTE = { id: 'r', label: 'Reroute the irrigation line', price: 550 }
const REMOVAL = { id: 'm', label: 'Remove the old equipment', price: 0 }

// --- what has to be filled in ------------------------------------------------

check('a name is the only thing a quote cannot be saved without',
  whatIsMissing({ customer_name: 'Warren' }) === '')
check('and without one it says so in words somebody can act on',
  whatIsMissing({ customer_name: '  ' }).includes('name'),
  whatIsMissing({ customer_name: '' }))
check('a blank address does not stop a quote being saved',
  whatIsMissing({ customer_name: 'Warren', address: '' }) === '')

// Sending is a higher bar than saving, and the difference is deliberate: the
// quote goes out by email, so there has to be one.
check('sending needs an email', canSend({ customer_name: 'Warren', customer_email: 'w@x.com' }))
check('and refuses without one', !canSend({ customer_name: 'Warren', customer_email: '' }))
check('and refuses something that is not one', !canSend({ customer_name: 'Warren', customer_email: 'warren' }))

// --- the total ---------------------------------------------------------------

const plain = quoteLines(FLAGSHIP, [])
check('a system on its own totals its price', plain.total === 2999, String(plain.total))
check('and is not marked incomplete', !plain.incomplete)

const withExtra = quoteLines(FLAGSHIP, [REROUTE])
check('an extra adds to the total', withExtra.total === 3549, String(withExtra.total))
check('and appears as its own line', withExtra.lines.length === 2)

const free = quoteLines(FLAGSHIP, [REMOVAL])
check('an extra priced at zero is still a line, because it was agreed to',
  free.lines.length === 2 && free.total === 2999)

// The one that matters.
const unpriced = quoteLines(CUSTOM, [REROUTE])
check('a preset with no price contributes nothing, not zero',
  unpriced.lines[0].amount === null, JSON.stringify(unpriced.lines[0]))
check('the total is the sum of what is known', unpriced.total === 550, String(unpriced.total))
check('and the quote is marked incomplete so nobody reads 550 as the price',
  unpriced.incomplete === true)

check('a fully priced quote is never marked incomplete', quoteLines(FLAGSHIP, [REROUTE]).incomplete === false)

// --- money -------------------------------------------------------------------

check('money reads as money', money(3549) === '$3,549.00', money(3549))
check('and a blank stays blank rather than becoming zero', money(null) === '', `"${money(null)}"`)
check('and so does something that is not a number', money('abc') === '')

console.log(failed === 0
  ? '\nAll quote checks passed.'
  : `\n${failed} quote check(s) failed.`)

process.exitCode = failed === 0 ? 0 : 1
