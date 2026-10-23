import {
  quoteLines, whatIsMissing, canSend, money, listWords, whatSendingNeeds,
  QUOTE_CHECKLIST_SECTIONS,
} from '../src/lib/quote.js'
import { CHECKLIST_ITEMS } from '../src/lib/salesChecklist.js'

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

// Sending is a higher bar than saving, and the difference is deliberate. The
// quote goes out by email, so there has to be one, and the document itself
// refuses without a phone, a system and a price: check:documents proves each
// of those blocks, which is why the page asks for them here rather than
// letting DocuSeal say no after the fact.
const SENDABLE = {
  customer_name: 'Warren',
  customer_email: 'w@x.com',
  phone: '(248) 496-8292',
  system_template: 'Flagship Bundle',
  sale_price: '3499',
}

check('a quote with everything the document needs can be sent', canSend(SENDABLE))
check('and refuses without an email', !canSend({ ...SENDABLE, customer_email: '' }))
check('and refuses something that is not an email', !canSend({ ...SENDABLE, customer_email: 'warren' }))
check('and refuses without a phone', !canSend({ ...SENDABLE, phone: '' }))
check('and refuses without a system', !canSend({ ...SENDABLE, system_template: '' }))
check('and refuses without a price', !canSend({ ...SENDABLE, sale_price: '' }))

// What it says is missing, in the order somebody would fix it.
check('it names what is missing rather than just refusing',
  whatSendingNeeds({ ...SENDABLE, phone: '', sale_price: '' }).join(' + ') === 'a phone number + a price',
  whatSendingNeeds({ ...SENDABLE, phone: '', sale_price: '' }).join(' + '))
check('and says nothing when nothing is missing',
  whatSendingNeeds(SENDABLE).length === 0)
check('two missing things read as a sentence',
  listWords(['an email address', 'a price']) === 'an email address and a price',
  listWords(['an email address', 'a price']))
check('three read as a sentence too',
  listWords(['a', 'b', 'c']) === 'a, b and c', listWords(['a', 'b', 'c']))

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

// --- the checklist groups ----------------------------------------------------
//
// Every question belongs to exactly one section. A question in none of them is
// invisible on the page; a question in two is answered twice and the second
// answer wins silently.

const grouped = QUOTE_CHECKLIST_SECTIONS.flatMap(s => s.keys)
const allKeys = CHECKLIST_ITEMS.map(i => i.key)

check('every checklist question is on the page',
  allKeys.every(key => grouped.includes(key)),
  allKeys.filter(key => !grouped.includes(key)).join(', '))
check('and none of them is in two sections',
  grouped.length === new Set(grouped).size)
check('and no section lists a question that does not exist',
  grouped.every(key => allKeys.includes(key)),
  grouped.filter(key => !allKeys.includes(key)).join(', '))

// The bulk action has to be true for the kind of question it covers. A
// blanket yes on a measurement would be inventing an answer.
const YESNO = ['yesno', 'yesnounknown']

for (const section of QUOTE_CHECKLIST_SECTIONS.filter(s => s.bulk === 'yes')) {
  const kinds = section.keys.map(key => CHECKLIST_ITEMS.find(i => i.key === key).kind)
  check(`${section.title} only clears questions that answer yes or no`,
    kinds.every(kind => YESNO.includes(kind)), kinds.join(', '))
}

console.log(failed === 0
  ? '\nAll quote checks passed.'
  : `\n${failed} quote check(s) failed.`)

process.exitCode = failed === 0 ? 0 : 1
