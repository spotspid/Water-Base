import { unsupportedPicks, pickCandidates } from '../src/lib/templates.js'
import { columnsThatFit, fitColumns } from '../src/lib/grid.js'

// Checks the build sheet warnings and the card grid arithmetic.
//
// The warning is the one that cried wolf: it flagged every faucet finish on
// any template carrying an RO line, because it asked whether an RO item was
// called Chrome. Each pick line now answers only for its own list.
//
// Run with: npm run check:templates

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const items = [
  { id: 'f1', category: 'Faucet', variant: 'Chrome', active: true },
  { id: 'f2', category: 'Faucet', variant: 'Brushed Nickel', active: true },
  { id: 'f3', category: 'Faucet', variant: 'Matte Black', active: true },
  { id: 'f4', category: 'Faucet', variant: 'Brushed Gold', active: true },
  { id: 'r1', category: 'RO', variant: 'Standard', active: true },
  { id: 'r2', category: 'RO', variant: 'Alkaline', active: false },
]

const finishes = ['Chrome', 'Brushed Nickel', 'Matte Black', 'Brushed Gold']
const roTypes = ['Standard', 'Alkaline']

const faucetLine = { line_type: 'customer_pick', pick_source: 'faucet_finish', pick_category: 'Faucet' }
const roLine = { line_type: 'customer_pick', pick_source: 'ro_type', pick_category: 'RO' }
const fixed = { line_type: 'fixed', item_id: 'f1' }

// --- each line answers for its own list ------------------------------------

const both = unsupportedPicks([fixed, faucetLine, roLine], items, { faucet_finish: finishes, ro_type: roTypes })
check('a template with a faucet line and an RO line does not flag the finishes',
  !both.some(g => g.source === 'faucet_finish'), JSON.stringify(both))
check('but it does flag the RO type with no active item',
  both.length === 1 && both[0].source === 'ro_type' && both[0].missing.join() === 'Alkaline',
  JSON.stringify(both))
check('and names the category the item is missing from', both[0]?.category === 'RO')

const faucetOnly = unsupportedPicks([faucetLine], items, { faucet_finish: finishes, ro_type: roTypes })
check('a faucet only template with every finish stocked warns about nothing', faucetOnly.length === 0)

const gone = items.map(i => (i.id === 'f3' ? { ...i, active: false } : i))
const inactive = unsupportedPicks([faucetLine], gone, { faucet_finish: finishes })
check('an inactive item does not count as a match',
  inactive.length === 1 && inactive[0].missing.join() === 'Matte Black', JSON.stringify(inactive))

check('a source with no settings list reports nothing rather than everything',
  unsupportedPicks([roLine], items, { faucet_finish: finishes }).length === 0)
check('fixed lines are never checked', unsupportedPicks([fixed], [], { faucet_finish: finishes }).length === 0)
check('a variant is matched exactly, as the deduct does',
  unsupportedPicks([faucetLine], items, { faucet_finish: ['chrome'] })[0]?.missing.join() === 'chrome')

check('garbage in is an empty list out',
  unsupportedPicks(null, undefined, null).length === 0
    && unsupportedPicks([null, {}], [null], { faucet_finish: finishes }).length === 0)

check('pick candidates are the active items with a variant in the category',
  pickCandidates(items, 'RO').map(i => i.id).join() === 'r1')

// --- card grids fit the count ------------------------------------------------

check('five cards in four columns become three and two', fitColumns(5, 4) === 3)
check('six cards in five columns become three and three', fitColumns(6, 5) === 3)
check('seven cards in five columns become four and three', fitColumns(7, 5) === 4)
check('cards that fit on one row stay on one row', fitColumns(5, 6) === 5 && fitColumns(3, 4) === 3)
check('one column when only one fits', fitColumns(5, 1) === 1)
check('never below two columns when two fit', fitColumns(5, 2) === 2)
check('no cards is one column, not zero', fitColumns(0, 4) === 1)
check('nonsense counts do not throw', fitColumns('x', null) === 1)

check('993px holds five 180px cards with 16px gaps', columnsThatFit(993, 180, 16) === 5)
check('993px holds four 200px cards with 18px gaps', columnsThatFit(993, 200, 18) === 4)
check('a hidden element measures as one column', columnsThatFit(0, 180, 16) === 1)

if (failed > 0) {
  console.error(`\n${failed} template check(s) failed.`)
  process.exit(1)
}

console.log('\nAll template checks passed.')
