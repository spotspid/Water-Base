import { todayBlockers, hasOverdue, todayHeadline } from '../src/lib/today.js'
import {
  BLOCKED, OUT, SIGNED,
  documentCounts, documentRows, groupByReason, inSection, installLabel,
} from '../src/lib/documents.js'
import { gapsSentence, workOrderBlocker, workOrderGaps } from '../src/lib/workOrder.js'

// Checks the today block and the Documents page.
//
// Both read one rule, workOrderGaps, and the point of most of what follows is
// that they cannot drift from it. A card that says "needs a payout" while the
// send button complains about a crew, or a backlog that lists work the button
// says is fine, is worse than either page not existing.
//
// The other thing tested hard is the pulse. It is the loudest thing in the
// product and it has exactly one job: fire when something is genuinely past
// its install date, and never otherwise.
//
// Run with: npm run check:documents

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const NOW = new Date('2026-09-09T12:00:00')

const ready = {
  id: 'j1',
  customer_name: 'Walter Radu',
  customer_email: 'walter@example.com',
  status: 'scheduled',
  scheduled_date: '2026-09-16',
  invoice_number: 'MWP-0007',
  installer_id: 'i1',
  installer_name: 'Jay Woodward',
  installer_email: 'jay@example.com',
  installer_pay: 450,
  template_id: 't1',
  template_line_count: 5,
  system_template: 'Flagship Bundle',
  agreement_status: 'completed',
  work_order_status: 'completed',
}

// --- one rule, two shapes ---------------------------------------------------

check('a ready job has no gaps', workOrderGaps(ready).length === 0)
check('and no blocker sentence', workOrderBlocker(ready) === '')

const bare = { ...ready, installer_id: null, installer_email: null, installer_pay: 0, invoice_number: null }
const gaps = workOrderGaps(bare)
check('a bare job reports every gap, not just the first', gaps.length === 4, gaps.map(g => g.key).join(','))
check('the blocker sentence is the first of them',
  workOrderBlocker(bare) === gaps[0].sentence)
check('and the card lists them all',
  gapsSentence(bare) === 'Needs a crew, a crew email, a payout and a job number',
  gapsSentence(bare))

check('one gap reads without a list', gapsSentence({ ...ready, installer_pay: 0 }) === 'Needs a payout')
check('two gaps join with and',
  gapsSentence({ ...ready, installer_pay: 0, invoice_number: null })
  === 'Needs a payout and a job number')
check('a ready job needs nothing', gapsSentence(ready) === '')

// --- the today block --------------------------------------------------------

check('a ready booked job is not blocked', todayBlockers([ready], NOW).length === 0)
check('an installed job never appears',
  todayBlockers([{ ...ready, status: 'installed', installer_pay: 0 }], NOW).length === 0)
check('an undated job never appears, however broken',
  todayBlockers([{ ...bare, scheduled_date: null }], NOW).length === 0,
  'nothing is promised to a customer yet')
check('a job past the horizon does not appear',
  todayBlockers([{ ...bare, scheduled_date: '2026-12-01' }], NOW).length === 0)

const cards = todayBlockers([
  { ...bare, id: 'a', customer_name: 'Later', scheduled_date: '2026-09-14' },
  { ...bare, id: 'b', customer_name: 'Overdue', scheduled_date: '2026-09-05' },
  { ...bare, id: 'c', customer_name: 'Today', scheduled_date: '2026-09-09' },
], NOW)

check('soonest first', cards.map(c => c.customer_name || c.who).join(',') === 'Overdue,Today,Later',
  cards.map(c => c.who).join(','))
check('a past date is late', cards[0].urgency === 'late' && cards[0].when === '4 days overdue')
check('today is now', cards[1].urgency === 'now' && cards[1].when === 'Installs today')
check('ahead is soon', cards[2].urgency === 'soon' && cards[2].when === 'In 5 days')

// --- the pulse, which is the loudest thing in the product -------------------

check('overdue work makes it beat', hasOverdue(cards) === true)
check('today alone does not', hasOverdue([cards[1]]) === false, 'today is not late')
check('future work does not', hasOverdue([cards[2]]) === false)
check('nothing blocked does not', hasOverdue([]) === false)
check('a missing list does not throw', hasOverdue(undefined) === false)

// --- the headline -----------------------------------------------------------

const sameCause = todayBlockers([
  { ...ready, id: 'a', installer_id: null, scheduled_date: '2026-09-10' },
  { ...ready, id: 'b', installer_id: null, scheduled_date: '2026-09-11' },
], NOW)
check('a shared cause is named', todayHeadline(sameCause).emphasis === 'no crew assigned')
check('and counted in words', todayHeadline(sameCause).lead.startsWith('Two installs are'))

const mixedCause = todayBlockers([
  { ...ready, id: 'a', installer_id: null, scheduled_date: '2026-09-10' },
  { ...ready, id: 'b', installer_pay: 0, scheduled_date: '2026-09-11' },
], NOW)
check('a cause only some share is never claimed for all',
  todayHeadline(mixedCause).emphasis === 'not ready to send',
  todayHeadline(mixedCause).emphasis)
check('one blocked job is singular', todayHeadline([sameCause[0]]).lead.startsWith('One install is'))
check('nothing blocked says so', todayHeadline([]).lead === 'Nothing is blocked.')

// --- the Documents page -----------------------------------------------------

const rows = documentRows([ready], NOW)
check('a job yields two documents', rows.length === 2)
check('both signed land in signed', rows.every(r => r.section === SIGNED))
check('and are counted as such', documentCounts(rows).signed === 2)

const blockedRows = documentRows([{ ...bare, work_order_status: null, agreement_status: null }], NOW)
check('an unsent work order on a bare job is blocked',
  blockedRows.find(r => r.type === 'subcontractor_service').section === BLOCKED)
check('but the agreement is sendable, it only needs an email',
  blockedRows.find(r => r.type === 'customer_install').section === OUT)

const sentThenBroken = documentRows([{
  ...bare, work_order_status: 'sent', work_order_sent_at: '2026-09-05T10:00:00Z',
}], NOW)
const wo = sentThenBroken.find(r => r.type === 'subcontractor_service')
check('a sent document stays out however broken the job became', wo.section === OUT)
check('and reports how long it has been out', wo.sentDays === 4, String(wo.sentDays))

const signedThenBroken = documentRows([{ ...bare, work_order_status: 'completed' }], NOW)
check('a signed document is never dragged back into the backlog',
  signedThenBroken.find(r => r.type === 'subcontractor_service').section === SIGNED)

// --- grouping, which is what turns a list into an afternoon of work ---------

const many = documentRows([
  { ...ready, id: 'a', customer_name: 'A', installer_id: null, work_order_status: null },
  { ...ready, id: 'b', customer_name: 'B', installer_id: null, work_order_status: null },
  { ...ready, id: 'c', customer_name: 'C', installer_pay: 0, work_order_status: null },
], NOW)

const groups = groupByReason(many)
check('blocked rows group by their reason', groups.length === 2, groups.map(g => g.key).join(','))
check('the biggest group leads', groups[0].rows.length === 2 && groups[0].key === 'crew')
check('and the reason is named', groups[0].short === 'a crew')
check('only blocked rows are grouped',
  groups.every(g => g.rows.every(r => r.section === BLOCKED)))

check('sections filter', inSection(many, BLOCKED).length === 3)
check('counts add up', documentCounts(many).total === 6 && documentCounts(many).blocked === 3)

// --- words ------------------------------------------------------------------

check('today reads today', installLabel({ untilInstall: 0 }) === 'Today')
check('overdue is positive and plain', installLabel({ untilInstall: -3 }) === '3 days overdue')
check('no date says no date', installLabel({ untilInstall: null }) === 'No date')

// --- rubbish in --------------------------------------------------------------

check('no jobs does not throw', documentRows(undefined, NOW).length === 0)
check('nor does grouping nothing', groupByReason(null).length === 0)
check('a bad date is no date',
  todayBlockers([{ ...bare, scheduled_date: 'nonsense' }], NOW).length === 0)
check('a cancelled job blocks rather than pretends to be sendable',
  documentRows([{ ...ready, status: 'cancelled', work_order_status: null }], NOW)
    .find(r => r.type === 'subcontractor_service').section === BLOCKED)

console.log('')
if (failed > 0) {
  console.error(`${failed} document check(s) failed.`)
  process.exit(1)
}
console.log('All document checks passed.')
