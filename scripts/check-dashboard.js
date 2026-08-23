import {
  atReorderPoint, groupActivity, monthStart, splitMonthRevenue, stockShortages,
} from '../src/lib/dashboard.js'

// Checks the dashboard's two summarising decisions, both of which are pure and
// both of which have been quietly wrong before.
//
// The revenue split: a month figure that adds signed contracts to finished
// installs is two claims wearing one number. Worse, an earlier fix partitioned
// them by dropping installed jobs out of sold, which made the booking figure
// fall every time a job got delivered. They overlap on purpose now, and the
// overlap is reported.
//
// The stock split: short means nothing free to sell, at the line means on hand
// has reached the reorder point with stock still free. Mixed together, eight of
// eleven parts read as needing attention and the two that did were buried.
//
// Run with: npm run check:dashboard
// No database and no browser, so it runs anywhere.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

// --- revenue, mirroring the live August book -------------------------------

const jobs = [
  { status: 'sold', created_at: '2026-08-02T12:00:00Z', install_date: null, sale_price: 3499 },
  { status: 'sold', created_at: '2026-08-05T12:00:00Z', install_date: null, sale_price: 3499 },
  { status: 'scheduled', created_at: '2026-08-07T12:00:00Z', install_date: null, sale_price: 3499 },
  { status: 'scheduled', created_at: '2026-08-11T12:00:00Z', install_date: null, sale_price: 3499 },
  { status: 'sold', created_at: '2026-08-14T12:00:00Z', install_date: null, sale_price: 4399 },
  { status: 'sold', created_at: '2026-08-18T12:00:00Z', install_date: null, sale_price: 3999 },
  // written and delivered in the same month, so it belongs in both figures
  { status: 'installed', created_at: '2026-08-19T12:00:00Z', install_date: '2026-08-19', sale_price: 2999 },
  // cancelled earns nothing and is in neither
  { status: 'cancelled', created_at: '2026-08-20T12:00:00Z', install_date: null, sale_price: 9999 },
  // sold in July, delivered in July, out of range on both counts
  { status: 'installed', created_at: '2026-07-10T12:00:00Z', install_date: '2026-07-15', sale_price: 5000 },
]

const august = splitMonthRevenue(jobs, monthStart(new Date(2026, 7, 23)))

check('sold counts every contract written this month', august.sold.count === 7, august.sold.count)
check('sold revenue keeps a job that was installed the same month',
  august.sold.revenue === 25393, august.sold.revenue)
check('installed counts only what was delivered this month',
  august.installed.count === 1, august.installed.count)
check('installed revenue is the delivered job', august.installed.revenue === 2999, august.installed.revenue)
check('the overlap between the two is reported', august.both === 1, august.both)
check('a cancelled job is in neither figure', !JSON.stringify(august).includes('9999'))
check('last month stays in last month', august.installed.revenue !== 7999)

// a month with nothing in it must read as zero rather than throw
const quiet = splitMonthRevenue([], monthStart(new Date(2026, 7, 23)))
check('an empty book is zero, not an error',
  quiet.sold.count === 0 && quiet.installed.count === 0 && quiet.both === 0)

// --- stock, mirroring the live catalog -------------------------------------

const stock = [
  // every bag promised to a booked job: short, even though 8 is well over the line
  { id: 'salt', name: 'Softener salt', on_hand: 8, committed: 8, available: 0, reorder_threshold: 2, active: true },
  // promised beyond what exists: the worst case, and it must sort first
  { id: 'over', name: 'Oversold part', on_hand: 1, committed: 3, available: -2, reorder_threshold: 1, active: true },
  // at the line, with stock still free. A purchasing note, not an alarm.
  { id: 'line', name: 'Filter set', on_hand: 1, committed: 0, available: 1, reorder_threshold: 1, active: true },
  // comfortable
  { id: 'fine', name: 'Chrome faucet', on_hand: 4, committed: 0, available: 4, reorder_threshold: 1, active: true },
  // inactive rows are not stock anyone can sell or reorder
  { id: 'off', name: 'Retired part', on_hand: 0, committed: 0, available: 0, reorder_threshold: 1, active: false },
]

const short = stockShortages(stock)
const line = atReorderPoint(stock)

check('only parts with nothing free are short', short.length === 2, short.map(r => r.id).join(','))
check('the oversold part leads the list', short[0]?.id === 'over', short[0]?.id)
check('an inactive part is never short', !short.some(r => r.id === 'off'))
check('at the line is its own list', line.length === 1 && line[0].id === 'line',
  line.map(r => r.id).join(','))
check('a short part is not also listed at the line', !line.some(r => r.id === 'salt'))
check('a comfortable part is in neither list',
  !short.some(r => r.id === 'fine') && !line.some(r => r.id === 'fine'))

// --- activity grouping -----------------------------------------------------

const ledger = [
  { id: 1, job_id: 'j1', deduct_batch: 1, quantity: -1, txn_type: 'install', unit_cost_at_txn: 100, source: 'template', jobs: { customer_name: 'Alice' } },
  { id: 2, job_id: 'j1', deduct_batch: 1, quantity: -2, txn_type: 'install', unit_cost_at_txn: 10, source: 'template', jobs: { customer_name: 'Alice' } },
  { id: 3, job_id: 'j1', deduct_batch: 1, quantity: -1, txn_type: 'install', unit_cost_at_txn: 50, source: 'template', jobs: { customer_name: 'Alice' } },
  // same job, second batch: a reinstall is its own event
  { id: 4, job_id: 'j1', deduct_batch: 2, quantity: -1, txn_type: 'install', unit_cost_at_txn: 100, source: 'template', jobs: { customer_name: 'Alice' } },
  // no job: two purchases on one day are two things
  { id: 5, job_id: null, deduct_batch: null, quantity: 10, txn_type: 'purchase', unit_cost_at_txn: 5, source: 'manual' },
  { id: 6, job_id: null, deduct_batch: null, quantity: 4, txn_type: 'purchase', unit_cost_at_txn: 5, source: 'manual' },
]

const entries = groupActivity(ledger)

check('one install folds into one entry', entries.length === 4, entries.length)
check('the folded entry keeps its line count', entries[0].lineCount === 3, entries[0].lineCount)
check('the folded entry sums the units drawn', entries[0].units === 4, entries[0].units)
check('a second batch is a separate entry', entries[1].single === true)
check('unjobbed rows never merge', entries[2].single && entries[3].single)
check('a group of one stays a plain row', entries[4] === undefined)

console.log(failed === 0
  ? '\nAll dashboard checks passed.\n'
  : `\n${failed} ${failed === 1 ? 'check' : 'checks'} failed.\n`)

process.exit(failed === 0 ? 0 : 1)
