import {
  atReorderPoint, billableJobs, groupActivity, monthStart, realJobs, soldNotBooked, splitMonthRevenue, stockShortages,
} from '../src/lib/dashboard.js'
import { jobViewLink, jobViewOf } from '../src/lib/jobViews.js'
import { daysSinceQuoteSent, quoteSummary } from '../src/lib/quotes.js'
import { jobListDate, sortByKeyDate } from '../src/lib/jobDates.js'
import { DEFAULT_SORT, sortJobs, sortStateFor } from '../src/lib/jobSort.js'

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
  // every bag promised to a booked job, and every bag physically here. Fully
  // allocated is not short: the booked jobs can have their salt.
  { id: 'salt', name: 'Softener salt', on_hand: 8, committed: 8, available: 0, reorder_threshold: 2, active: true },
  // nothing on the shelf and nobody asking. This is the case that used to fill
  // the dashboard: 14 SKUs from an unreceived order, none of them blocking a
  // job. It is something the business does not stock, not a shortage.
  { id: 'unstocked', name: 'Never stocked part', on_hand: 0, committed: 0, available: 0, reorder_threshold: 0, active: true },
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

// A shortage needs both halves: something wants the part, and the shelf cannot
// supply it. Either alone is ordinary, and treating "nothing free" as a
// shortage is what put 14 unblocking SKUs on the dashboard.
check('only a part promised beyond the shelf is short', short.length === 1, short.map(r => r.id).join(','))
check('and that is the oversold one', short[0]?.id === 'over', short[0]?.id)
check('fully allocated is not short, the parts are here',
  !short.some(r => r.id === 'salt'))
check('a part nobody wants is not short however empty the shelf',
  !short.some(r => r.id === 'unstocked'))
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

// --- the not-booked tile and the list it opens ------------------------------
//
// The tile counts with soldNotBooked and links to /jobs?view=not-booked. The
// jobs page must run that same rule, or the list and the number drift apart.

const booking = [
  { id: 'a', status: 'sold', scheduled_date: null },
  { id: 'b', status: 'sold', scheduled_date: '' },
  { id: 'c', status: 'sold', scheduled_date: '2026-09-30' },
  { id: 'd', status: 'scheduled', scheduled_date: '2026-09-24' },
  { id: 'e', status: 'scheduled', scheduled_date: null },
  { id: 'f', status: 'cancelled', scheduled_date: null },
  { id: 'g', status: 'installed', scheduled_date: null },
]

const notBookedView = jobViewOf('not-booked')
const tileIds = soldNotBooked(booking).map(j => j.id).join(',')
const listIds = notBookedView ? notBookedView.filter(booking).map(j => j.id).join(',') : 'no view'

check('the not-booked view exists', notBookedView !== null)
check('the list is exactly the jobs the tile counts', listIds === tileIds, `${listIds} vs ${tileIds}`)
check('only sold jobs with no date are counted', tileIds === 'a,b', tileIds)
check('the tile links to that view', jobViewLink('not-booked') === '/jobs?view=not-booked', jobViewLink('not-booked'))
check('an unknown view is refused, not guessed', jobViewOf('toString') === null && jobViewOf('nope') === null)

// --- quotes -------------------------------------------------------------------

const withQuote = [
  { status: 'quoted', created_at: '2026-08-03T12:00:00Z', sold_at: null, install_date: null, sale_price: 5000, scheduled_date: null },
  // written in July as a quote, signed in August: an August sale
  { status: 'sold', created_at: '2026-07-28T12:00:00Z', sold_at: '2026-08-02T15:00:00Z', install_date: null, sale_price: 3000, scheduled_date: null },
]
const aug = splitMonthRevenue(withQuote, monthStart(new Date(2026, 7, 23)))
check('a quote is not sold revenue', aug.sold.count === 1 && aug.sold.revenue === 3000, JSON.stringify(aug.sold))
check('a signed quote is dated by sold_at, not the day it was written', aug.sold.revenue === 3000)
check('a quote is not waiting to be booked', soldNotBooked(withQuote).length === 1)
check('a quote is not billable', billableJobs(withQuote).length === 1)

// --- quotes out tile and its list ---------------------------------------------

const today = new Date(2026, 8, 20, 9, 0)
const book = [
  { id: 'q1', status: 'quoted', sale_price: 3000, quote_sent_at: '2026-09-18T15:00:00' },
  { id: 'q2', status: 'quoted', sale_price: 4500, quote_sent_at: '2026-09-08T15:00:00' },
  // a draft nobody has sent is not a quote out
  { id: 'q3', status: 'quoted', sale_price: 9999, quote_sent_at: null },
  { id: 's1', status: 'sold', sale_price: 2000, quote_sent_at: '2026-09-01T15:00:00' },
]
const qs = quoteSummary(book, today)
check('quotes out counts only sent quotes', qs.count === 2, qs.count)
check('quotes out totals their value', qs.value === 7500, qs.value)
check('the oldest is in whole days since sent', qs.oldestDays === 12, qs.oldestDays)
check('sent yesterday evening is one day old', daysSinceQuoteSent(book[0], new Date(2026, 8, 19, 8)) === 1)
const quotesView = jobViewOf('quotes')
check('the quotes list is the tile, oldest first',
  quotesView && quotesView.filter(book).map(j => j.id).join(',') === 'q2,q1')
check('the tile links to that view', jobViewLink('quotes') === '/jobs?view=quotes')

// --- test jobs --------------------------------------------------------------

const marked = realJobs([
  { id: 'real', is_test: false },
  { id: 'test', is_test: true },
  // a database one migration behind has no is_test at all: count the job
  { id: 'old' },
])
check('a job marked is_test is counted nowhere', marked.map(j => j.id).join(',') === 'real,old',
  marked.map(j => j.id).join(','))

// --- the jobs list is sorted by the date its Key date column shows -------------
//
// One function for both, so the order and the column cannot disagree. Sorting
// on created_at instead would put an install that happened in August under a
// job written up yesterday.

const installed = { id: 'i', status: 'installed', install_date: '2026-08-25', created_at: '2026-09-16T18:35:27Z' }
const booked = { id: 's', status: 'scheduled', scheduled_date: '2026-09-28', created_at: '2026-09-01T10:00:00Z' }
const written = { id: 'w', status: 'sold', created_at: '2026-09-17T09:00:00Z' }
const noDate = { id: 'x', status: 'installed', install_date: null, created_at: '2026-07-01T09:00:00Z' }
const broken = { id: 'b', status: 'sold', created_at: 'not a date' }

check('an installed job is filed under its install date',
  jobListDate(installed).kind === 'Installed' && jobListDate(installed).date.getFullYear() === 2026
  && jobListDate(installed).date.getMonth() === 7 && jobListDate(installed).date.getDate() === 25)
check('a day string is read locally, not as UTC midnight',
  jobListDate(installed).date.getDate() === 25, String(jobListDate(installed).date))
check('a booked job is filed under its scheduled date', jobListDate(booked).kind === 'Scheduled')
check('anything else is filed under when it was written up', jobListDate(written).kind === 'Written up')
check('an installed job with no install date falls back rather than blanking',
  jobListDate(noDate).kind === 'Written up')

check('the list runs newest key date first',
  sortByKeyDate([installed, booked, written, noDate]).map(j => j.id).join() === 's,w,i,x',
  sortByKeyDate([installed, booked, written, noDate]).map(j => j.id).join())
check('a row whose date cannot be read sinks to the bottom',
  sortByKeyDate([broken, written]).map(j => j.id).join() === 'w,b')
check('sorting returns a new array rather than reordering the one passed in', (() => {
  const list = [installed, booked]
  sortByKeyDate(list)
  return list[0].id === 'i'
})())
check('an empty list sorts to an empty list', sortByKeyDate([]).length === 0)
check('a null list does not throw', sortByKeyDate(null).length === 0)

// --- sorting the jobs table by any column --------------------------------------
//
// The default has to stay the key date order the column produces, and a blank
// has to sink whichever way the column points: a job with no parts figure is
// not the cheapest job.

const a = { id: 'a', customer_name: 'Ashley', status: 'sold', created_at: '2026-08-10T09:00:00Z',
  sale_price: 2999, parts_cost_effective: 758.71, installer_pay: 0, margin: null, agreement_status: 'completed' }
const b = { id: 'b', customer_name: 'neil', status: 'installed', install_date: '2026-09-08',
  created_at: '2026-09-01T09:00:00Z', sale_price: 6999, parts_cost_effective: 1712.16, installer_pay: 1600,
  margin: 3686.84, agreement_status: 'completed' }
const c = { id: 'c', customer_name: 'Zoe', status: 'scheduled', scheduled_date: '2026-09-28',
  created_at: '2026-07-01T09:00:00Z', sale_price: 1099, parts_cost_effective: null, installer_pay: 0,
  margin: 1000, agreement_status: 'none' }
const list = [a, b, c]
const ids = sort => sortJobs(list, sort).map(j => j.id).join()

check('the default is the key date order the column produces',
  ids(DEFAULT_SORT) === sortByKeyDate(list).map(j => j.id).join(), ids(DEFAULT_SORT))
check('and that is newest first', ids(DEFAULT_SORT) === 'c,b,a', ids(DEFAULT_SORT))
check('no sort at all falls back to the same order', sortJobs(list).map(j => j.id).join() === 'c,b,a')
check('an unknown column falls back rather than throwing',
  sortJobs(list, { column: 'nonsense', direction: 'asc' }).map(j => j.id).join() === 'c,b,a')

check('customer sorts A to Z, ignoring case', ids({ column: 'customer', direction: 'asc' }) === 'a,b,c')
check('and Z to A the other way', ids({ column: 'customer', direction: 'desc' }) === 'c,b,a')
check('price sorts biggest first', ids({ column: 'price', direction: 'desc' }) === 'b,a,c')
check('pay sorts smallest first when asked', ids({ column: 'pay', direction: 'asc' }) === 'a,c,b')
check('status sorts by how far along, not alphabetically',
  ids({ column: 'status', direction: 'asc' }) === 'a,c,b', ids({ column: 'status', direction: 'asc' }))

check('a job with no parts figure sinks when sorted descending',
  ids({ column: 'parts', direction: 'desc' }) === 'b,a,c')
check('and still sinks when sorted ascending, rather than reading as cheapest',
  ids({ column: 'parts', direction: 'asc' }) === 'a,b,c', ids({ column: 'parts', direction: 'asc' }))
check('a job with no profit figure sinks either way',
  ids({ column: 'profit', direction: 'asc' }).endsWith('a') && ids({ column: 'profit', direction: 'desc' }).endsWith('a'))

check('pressing a new column uses that column start direction',
  sortStateFor('customer', DEFAULT_SORT).direction === 'asc')
check('and money starts at the biggest', sortStateFor('price', DEFAULT_SORT).direction === 'desc')
check('pressing the same column turns it round',
  sortStateFor('date', DEFAULT_SORT).direction === 'asc')
check('and turns it back', sortStateFor('date', sortStateFor('date', DEFAULT_SORT)).direction === 'desc')
check('an unknown column leaves the sort alone',
  sortStateFor('nonsense', DEFAULT_SORT) === DEFAULT_SORT)
check('sorting returns a new array', sortJobs(list, { column: 'price', direction: 'asc' }) !== list)
check('an empty list sorts to an empty list', sortJobs([], { column: 'price', direction: 'asc' }).length === 0)
check('a null list does not throw', sortJobs(null, { column: 'price', direction: 'asc' }).length === 0)

console.log(failed === 0
  ? '\nAll dashboard checks passed.\n'
  : `\n${failed} ${failed === 1 ? 'check' : 'checks'} failed.\n`)

process.exit(failed === 0 ? 0 : 1)
