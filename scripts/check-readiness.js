import {
  EMPTY_SHEET, NO_SHEET, READY, SHORT, UNRESOLVED,
  readinessByJob, readinessOf, readyCount, worstOf,
} from '../src/lib/readiness.js'

// Checks the badge on the schedule card.
//
// The badge answers the brand kit's design test, "at a glance, can an operator
// tell whether Thursday's install has every required part". Everything it can
// get wrong is expensive in the same direction: a van that leaves the yard
// without a tank because a card said Ready.
//
// So the cases that matter most here are the ones where the truthful answer is
// "I do not know". A failed request and a job with no readiness row must both
// come out as no badge, never as good news.
//
// Run with: npm run check:readiness
// No database and no browser, so it runs anywhere.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const ok = {
  job_id: 'a', checked: true, has_sheet: true,
  sheet_lines: 5, unresolved_lines: 0, short_items: 0, short_units: 0,
}

// --- absence is never good news --------------------------------------------

check('no facts at all is no badge', readinessOf(undefined) === null)
check('null is no badge', readinessOf(null) === null)
check('a job missing from the answer is no badge', readinessOf(readinessByJob([])['nope']) === null)
check('an installed job is no badge rather than ready',
  readinessOf({ ...ok, checked: false }) === null)

// --- the ordinary good case ------------------------------------------------

check('everything free reads ready', readinessOf(ok).state === READY)
check('and is toned ok', readinessOf(ok).tone === 'ok')
check('and says so in one word', readinessOf(ok).label === 'Ready')
check('and counts the parts in its detail',
  readinessOf(ok).detail.includes('5 parts'))

// --- shortages -------------------------------------------------------------

const short = { ...ok, short_items: 2, short_units: 3 }
check('a shortage reads short', readinessOf(short).state === SHORT)
check('and is toned bad', readinessOf(short).tone === 'bad')
check('the badge counts units, not items, because units is what is missing',
  readinessOf(short).label === 'Short 3')
check('the detail names both figures',
  readinessOf(short).detail.includes('2 parts are')
  && readinessOf(short).detail.includes('3 units'))
check('one short part reads singular',
  readinessOf({ ...ok, short_items: 1, short_units: 1 }).detail.includes('1 part is'))
check('a short count with no unit figure still shows something',
  readinessOf({ ...ok, short_items: 2, short_units: 0 }).label === 'Short 2')

// --- lines nobody has chosen yet -------------------------------------------

const pick = { ...ok, unresolved_lines: 2 }
check('unresolved lines read as a choice to make', readinessOf(pick).state === UNRESOLVED)
check('and are amber rather than an exception', readinessOf(pick).tone === 'warn')
check('and say how many', readinessOf(pick).label === 'Pick 2')

// A job can be both. Short wins the badge, because the shortage is concrete,
// but the detail has to admit the number could get worse once the rest resolve.
const both = { ...ok, short_items: 1, short_units: 1, unresolved_lines: 2 }
check('short outranks unresolved on the badge', readinessOf(both).state === SHORT)
check('and the detail warns the figure is incomplete',
  readinessOf(both).detail.includes('could be worse'))

// --- the trap this exists to catch -----------------------------------------

// An empty sheet resolves cleanly and is short of nothing, so every count
// above is zero and it would otherwise be the readiest job on the board.
const empty = { ...ok, sheet_lines: 0 }
check('an empty build sheet is not ready', readinessOf(empty).state === EMPTY_SHEET)
check('and is treated as an exception', readinessOf(empty).tone === 'bad')
check('and outranks a shortage, because it hides one',
  readinessOf({ ...empty, short_items: 9, short_units: 9 }).state === EMPTY_SHEET)

const noSheet = { ...ok, has_sheet: false, sheet_lines: 0 }
check('no build sheet at all says so', readinessOf(noSheet).state === NO_SHEET)
check('and outranks everything', readinessOf({ ...noSheet, short_items: 4 }).state === NO_SHEET)

// --- a day, not a job ------------------------------------------------------

const day = [ok, { ...ok, job_id: 'b' }, short]
check('a day is as bad as its worst job', worstOf(day).state === SHORT)
check('a day of ready jobs is ready', worstOf([ok, { ...ok, job_id: 'b' }]).state === READY)
check('a day with nothing to say says nothing',
  worstOf([{ ...ok, checked: false }]) === null)
check('an empty day says nothing', worstOf([]) === null)
check('a missing list does not throw', worstOf(undefined) === null)

check('two of three ready counts two',
  readyCount(day).ready === 2 && readyCount(day).known === 3)
check('a job with no answer is not counted as known',
  readyCount([ok, { ...ok, checked: false }]).known === 1)
check('nor as ready', readyCount([ok, { ...ok, checked: false }]).ready === 1)

// --- keying by job ---------------------------------------------------------

const keyed = readinessByJob([ok, { ...ok, job_id: 'b', short_items: 1, short_units: 1 }])
check('rows key by job id', keyed.a === ok && keyed.b.short_items === 1)
check('a row with no id is skipped', Object.keys(readinessByJob([{ checked: true }])).length === 0)
check('a null row list is an empty map', Object.keys(readinessByJob(null)).length === 0)

// --- rubbish in, no badge out rather than a crash --------------------------

check('a string count does not throw',
  readinessOf({ ...ok, short_items: '2', short_units: '3' }).label === 'Short 3')
check('a negative count is treated as none',
  readinessOf({ ...ok, short_items: -4 }).state === READY)
check('NaN is treated as none', readinessOf({ ...ok, unresolved_lines: NaN }).state === READY)

console.log('')
if (failed > 0) {
  console.error(`${failed} readiness check(s) failed.`)
  process.exit(1)
}
console.log('All readiness checks passed.')
