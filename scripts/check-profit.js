import {
  ACTUAL, EXPECTED, PARTIAL, NONE, GROSS, NET, NOT_COSTED,
  basisTag, canShowProfit, profitTotals, totalsNote,
} from '../src/lib/profit.js'

// Checks the profit vocabulary and the totals behind it.
//
// This is the arithmetic that produced 30,080.05 on Jobs against 1,838.05 on
// Profit and loss, both labelled as what the business had made. The cause was
// that a job with no parts recorded and a job needing no parts were the same
// value, zero, so eight uninstalled jobs contributed their whole sale price as
// profit and one of them read 100 percent.
//
// So the rule being tested is not "the sum is right". It is that a figure
// nobody can stand behind never reaches the screen as a number.
//
// Run with: npm run check:profit

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// --- one word, two scopes --------------------------------------------------

check('both pages use the word profit', GROSS.includes('profit') && NET.includes('profit'))
check('and the scope is what separates them', GROSS !== NET)

// --- what may be shown as a number -----------------------------------------

check('an installed job may show a profit', canShowProfit(ACTUAL))
check('so may one whose parts list resolves in full', canShowProfit(EXPECTED))
check('a job with unresolvable lines may not', !canShowProfit(PARTIAL))
check('nor may one with no parts list at all', !canShowProfit(NONE))
check('nor may anything unrecognised', !canShowProfit('something else') && !canShowProfit(undefined))

// --- the qualifier beside a figure -----------------------------------------

check('a settled figure carries no qualifier, because actual is the default',
  basisTag(ACTUAL) === '')
check('an estimate says so', basisTag(EXPECTED) === 'expected')
check('an incomplete one says so differently', basisTag(PARTIAL) === 'incomplete')
check('and an uncosted job says that', basisTag(NONE) === 'not costed')

// --- totals ----------------------------------------------------------------

// The live shape at the time of writing: one installed job, six with a full
// parts list, two that cannot name every part yet.
const jobs = [
  { sale_price: 2999, installer_pay: 0, parts_cost_effective: 1160.95, parts_cost_basis: ACTUAL, margin: 1838.05 },
  { sale_price: 6999, installer_pay: 500, parts_cost_effective: 1712.16, parts_cost_basis: EXPECTED, margin: 4786.84 },
  { sale_price: 3799, installer_pay: 0, parts_cost_effective: 1712.16, parts_cost_basis: EXPECTED, margin: 2086.84 },
  { sale_price: 2999, installer_pay: 0, parts_cost_effective: 758.71, parts_cost_basis: PARTIAL, margin: null },
  { sale_price: 2999, installer_pay: 0, parts_cost_effective: null, parts_cost_basis: NONE, margin: null },
]

const t = profitTotals(jobs)

check('settled and expected profit are kept apart',
  t.actual === 1838.05 && Math.abs(t.expected - 6873.68) < 0.005,
  `${t.actual} / ${t.expected}`)
check('and counted separately', t.actualJobs === 1 && t.expectedJobs === 2)

// The whole point. An uncosted job used to contribute its entire sale price.
check('a job that is not costed contributes nothing to profit',
  Math.abs(t.combined - (1838.05 + 6873.68)) < 0.005, String(t.combined))
check('and is counted as missing rather than ignored', t.uncosted === 2)

check('contracted value still counts every job',
  t.revenue === 2999 + 6999 + 3799 + 2999 + 2999, String(t.revenue))
check('parts sum what is known and skip what is not',
  Math.abs(t.parts - (1160.95 + 1712.16 + 1712.16 + 758.71)) < 0.005, String(t.parts))
check('installer pay is unaffected by any of this', t.pay === 500)

// --- the sentence under the figure -----------------------------------------

const note = totalsNote(t)
check('the note says how many are settled', note.includes('1 installed'), note)
check('and how many are estimates', note.includes('2 expected'), note)
check('and admits what is missing', note.includes('2 jobs are not costed yet'), note)

const allActual = profitTotals([jobs[0]])
check('with nothing missing it does not mention missing jobs',
  !totalsNote(allActual).includes('not costed'), totalsNote(allActual))

const nothing = profitTotals([])
check('an empty list says there is nothing to total',
  totalsNote(nothing).includes('nothing to total'), totalsNote(nothing))
check('and totals zero rather than throwing', nothing.combined === 0)

// --- rubbish in --------------------------------------------------------------
//
// These read whatever the view returned. A malformed row must not be able to
// turn into a confident number.

const junk = profitTotals([
  { sale_price: 'x', installer_pay: null, margin: 'nonsense', parts_cost_basis: EXPECTED },
  null,
  { sale_price: 1000, margin: 400 },
])
check('a non numeric profit does not become NaN', Number.isFinite(junk.combined), String(junk.combined))
check('a null row does not throw', junk.uncosted >= 1)
check('a row with no basis is treated as not costed', junk.combined === 0, String(junk.combined))

check('there is a phrase for a figure that cannot be shown', NOT_COSTED.length > 0)

console.log(failed === 0
  ? '\nAll profit checks passed.'
  : `\n${failed} profit check(s) failed.`)

process.exit(failed === 0 ? 0 : 1)
