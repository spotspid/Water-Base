import {
  addMonths, formatWeekLabel, groupByDate, isMovable, monthGrid,
  parseISODate, sortForList, startOfWeek, toISODate, weekDays,
} from '../src/lib/schedule.js'

// Checks the schedule date helpers, which are pure and are the part of the
// calendar most likely to be quietly wrong.
//
// The bug this exists to catch: a Postgres date arrives as the string
// YYYY-MM-DD, and new Date() parses that as midnight UTC. In any negative
// offset, which is every US timezone, that lands on the previous calendar
// day, so a job booked for the 7th renders on the 6th. Nothing about that
// failure looks like a bug in a screenshot, it just shows the wrong day.
//
// Run with: npm run check:dates
// This needs no database and no browser, so it is safe to run anywhere.

let failed = 0

function check(name, condition, detail = '') {
  const mark = condition ? '  PASS  ' : '  FAIL  '
  console.log(mark + name + (detail ? `  ${detail}` : ''))
  if (!condition) failed++
}

// --- the local day is preserved end to end ---------------------------------

const sep7 = parseISODate('2026-09-07')

check('parseISODate keeps the local day', toISODate(sep7) === '2026-09-07', toISODate(sep7))
check('2026-09-07 really is a Monday', sep7.getDay() === 1, `getDay=${sep7.getDay()}`)
check('a full timestamp still reads as its own day',
  toISODate(parseISODate('2026-09-07T00:00:00+00:00')) === '2026-09-07')

// --- the week runs Monday to Sunday ----------------------------------------

const week = weekDays(sep7)

check('a week is seven days', week.length === 7)
check('the week starts Monday Sep 7', toISODate(week[0]) === '2026-09-07', toISODate(week[0]))
check('the week ends Sunday Sep 13', toISODate(week[6]) === '2026-09-13', toISODate(week[6]))
check('the label reads the way the week is talked about',
  formatWeekLabel(sep7) === 'Week of September 7, 2026', formatWeekLabel(sep7))

// a Sunday belongs to the week that began the previous Monday, not the next
check('Sunday belongs to the week that started Monday',
  toISODate(startOfWeek(parseISODate('2026-09-13'))) === '2026-09-07',
  toISODate(startOfWeek(parseISODate('2026-09-13'))))

// --- the month grid is a stable six rows -----------------------------------

const grid = monthGrid(parseISODate('2026-09-15'))

check('the month grid is always 42 cells', grid.length === 42, `got ${grid.length}`)
check('the month grid starts on a Monday', grid[0].getDay() === 1)
check('the month grid contains the 1st', grid.some(d => toISODate(d) === '2026-09-01'))
check('the month grid contains the last day', grid.some(d => toISODate(d) === '2026-09-30'))

// stepping a month from the 31st must not skip the short month entirely
check('stepping a month anchors to the 1st',
  toISODate(addMonths(parseISODate('2026-01-31'), 1)) === '2026-02-01',
  toISODate(addMonths(parseISODate('2026-01-31'), 1)))

// --- bad input is refused rather than rolled forward -----------------------

check('rejects a day that month does not have', parseISODate('2026-02-30') === null)
check('rejects a month that does not exist', parseISODate('2026-13-01') === null)
check('rejects text', parseISODate('not-a-date') === null)
check('rejects empty', parseISODate('') === null)
check('rejects null', parseISODate(null) === null)

// --- grouping and ordering -------------------------------------------------

const rows = [
  { id: 'a', calendar_date: '2026-09-09', time_window_sort: 20, customer_name: 'Bob' },
  { id: 'b', calendar_date: '2026-09-09', time_window_sort: 10, customer_name: 'Zed' },
  { id: 'c', calendar_date: null, time_window_sort: 9999, customer_name: 'Ann' },
]
const grouped = groupByDate(rows)

check('rows group onto their day', (grouped.get('2026-09-09') || []).length === 2)
check('an undated row never lands on the grid', grouped.size === 1)
check('the earlier window sorts first within a day',
  grouped.get('2026-09-09')[0].customer_name === 'Zed')
check('unscheduled work sorts to the top of the list',
  sortForList(rows)[0].customer_name === 'Ann')

// --- what may be dragged ---------------------------------------------------

check('an installed job cannot be moved', !isMovable({ status: 'installed' }))
check('a cancelled job cannot be moved', !isMovable({ status: 'cancelled' }))
check('a job whose parts are deducted cannot be moved',
  !isMovable({ status: 'sold', parts_deducted_at: '2026-01-01' }))
check('a sold job can be moved', isMovable({ status: 'sold' }))

console.log(failed === 0
  ? '\nAll date checks passed.\n'
  : `\n${failed} ${failed === 1 ? 'check' : 'checks'} failed.\n`)

process.exit(failed === 0 ? 0 : 1)
