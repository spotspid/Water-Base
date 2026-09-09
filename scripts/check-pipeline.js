import { freshness, funnelBands, hasPipeline, pipelineMoney } from '../src/lib/pipeline.js'

// Checks the CRM strip on the dashboard.
//
// The risk here is not a wrong number, it is a confident one. This panel shows
// figures pulled from another system on a schedule, so the two ways it can
// mislead are showing a stale picture as if it were current, and showing an
// empty pipeline as if it were a real zero when nothing has synced at all.
// Both are tested below.
//
// Run with: npm run check:pipeline
// No database and no browser, so it runs anywhere.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const NOW = new Date('2026-09-09T20:00:00Z')
const ago = mins => new Date(NOW.getTime() - mins * 60000).toISOString()

// --- staleness, which is the whole safety story -----------------------------

check('a fresh sync reads as fresh', freshness(ago(20), NOW).state === 'fresh')
check('and says how long ago', freshness(ago(20), NOW).label === '20 min ago')
check('under two minutes is just now', freshness(ago(1), NOW).label === 'just now')
check('an hour is still fresh, the sync runs hourly',
  freshness(ago(75), NOW).state === 'fresh')
check('past ninety minutes is stale', freshness(ago(120), NOW).state === 'stale')
check('and reads in hours', freshness(ago(180), NOW).label === '3 hr ago')
check('a day out reads in days', freshness(ago(60 * 30), NOW).label === '1 day ago')
check('several days pluralise', freshness(ago(60 * 24 * 3), NOW).label === '3 days ago')

check('no timestamp is never synced, not fresh',
  freshness(null, NOW).state === 'never' && freshness(null, NOW).label === 'never synced')
check('rubbish is never synced rather than NaN',
  freshness('not a date', NOW).state === 'never')
check('a clock skewed future stamp does not read as negative',
  freshness(new Date(NOW.getTime() + 60000).toISOString(), NOW).label === 'just now')

// --- an empty pipeline is not the same as no pipeline -----------------------

check('nothing synced draws nothing', hasPipeline(null) === false)
check('a summary of zero rows draws nothing', hasPipeline({ total_count: 0 }) === false)
check('a real pipeline draws', hasPipeline({ total_count: 152 }) === true)
check('zero open with real rows behind it still draws',
  hasPipeline({ total_count: 40, open_count: 0 }) === true)

// --- the funnel -------------------------------------------------------------

const rows = [
  { stage_name: 'New Lead', opportunities: 40, value: 100000 },
  { stage_name: 'Quote Sent', opportunities: 10, value: 30000 },
  { stage_name: 'Follow-Up', opportunities: 1, value: 2749 },
  { stage_name: 'Empty', opportunities: 0, value: 0 },
]

const bands = funnelBands(rows)
check('a stage with nothing in it is dropped', bands.length === 3)
check('the biggest stage fills the track', bands[0].width === 100)
check('and the rest are relative to it, not to the total', bands[1].width === 25)
check('a single opportunity still draws a visible band',
  bands[2].width >= 4, `got ${bands[2].width}`)
check('counts and values survive', bands[0].count === 40 && bands[0].value === 100000)

check('an unnamed stage is labelled rather than blank',
  funnelBands([{ stage_name: '   ', opportunities: 3 }])[0].stage === 'Unnamed stage')
check('a missing list does not throw', funnelBands(undefined).length === 0)
check('a null list does not throw', funnelBands(null).length === 0)
check('all stages empty gives no bands', funnelBands([{ stage_name: 'x', opportunities: 0 }]).length === 0)

// --- money ------------------------------------------------------------------

check('whole dollars, no cents', pipelineMoney(20893) === '$20,893')
check('cents are rounded away rather than shown',
  pipelineMoney(2749.49) === '$2,749')
check('zero is zero, not blank', pipelineMoney(0) === '$0')
check('a missing value is zero rather than NaN', pipelineMoney(undefined) === '$0')
check('a string amount still formats', pipelineMoney('14997.00') === '$14,997')

console.log('')
if (failed > 0) {
  console.error(`${failed} pipeline check(s) failed.`)
  process.exit(1)
}
console.log('All pipeline checks passed.')
