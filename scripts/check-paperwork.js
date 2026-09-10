import {
  CUSTOMER, WORK_ORDER,
  installLabel, isOverdue, isUrgent, jobsWaiting, pendingPaperwork, waitedLabel,
} from '../src/lib/paperwork.js'

// Checks the panel that replaced the stock table on the dashboard.
//
// The failure that matters is the same one the stock table had: showing rows
// that are not really problems until nobody reads the panel. So the tests
// below care most about what must NOT appear. A signed document, an installed
// job and a cancelled job all have to be silent, or this becomes another list
// of everything.
//
// Run with: npm run check:paperwork
// No database and no browser, so it runs anywhere.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const NOW = new Date('2026-09-09T12:00:00')
const daysAgo = n => new Date(NOW.getTime() - n * 86400000).toISOString()

// A job that could send either document today. Everything workOrderBlocker
// asks for is here on purpose, because the panel now only lists documents
// somebody could actually send, and a fixture missing a payout would be
// filtered rather than tested.
const base = {
  id: 'j1',
  customer_name: 'Walter Radu',
  customer_email: 'walter@example.com',
  status: 'scheduled',
  created_at: daysAgo(10),
  scheduled_date: '2026-09-16',
  installer_id: 'i1',
  installer_name: 'Jay Woodward',
  installer_email: 'jay@example.com',
  installer_pay: 450,
  template_id: 't1',
  template_line_count: 5,
  system_template: 'Flagship Bundle',
  // required by the work order document, so a fixture without it is blocked
  invoice_number: 'MWP-0007',
  agreement_status: 'completed',
  work_order_status: 'completed',
}

// --- silence, which is the whole point --------------------------------------

check('both signed says nothing', pendingPaperwork([base], NOW).length === 0)
check('an installed job says nothing',
  pendingPaperwork([{ ...base, status: 'installed', work_order_status: 'sent' }], NOW).length === 0)
check('a cancelled job says nothing',
  pendingPaperwork([{ ...base, status: 'cancelled', work_order_status: null }], NOW).length === 0)
check('no jobs at all does not throw', pendingPaperwork(undefined, NOW).length === 0)
check('a null list does not throw', pendingPaperwork(null, NOW).length === 0)

// --- the states that do speak -----------------------------------------------

const unsent = pendingPaperwork([{ ...base, work_order_status: null }], NOW)
check('a work order never sent is one row', unsent.length === 1)
check('and is named as never sent', unsent[0].label === 'Never sent')
check('and is the work order, not the agreement', unsent[0].type === WORK_ORDER)
check('its wait is measured from when the job was written up',
  unsent[0].waitedDays === 10 && unsent[0].waitedFrom === 'written up')

const sent = pendingPaperwork([{ ...base, work_order_status: 'sent', work_order_sent_at: daysAgo(3) }], NOW)
check('sent and unsigned reads as such', sent[0].label === 'Sent, unsigned')
check('and its wait is measured from the send', sent[0].waitedDays === 3 && sent[0].waitedFrom === 'sent')

const declined = pendingPaperwork([{ ...base, agreement_status: 'declined', agreement_sent_at: daysAgo(2) }], NOW)
check('a decline is outstanding, not settled', declined.length === 1)
check('and is toned as an exception', declined[0].tone === 'bad' && declined[0].label === 'Declined')
check('and is the customer agreement', declined[0].type === CUSTOMER)

const failedSend = pendingPaperwork([{ ...base, work_order_status: 'failed', work_order_sent_at: daysAgo(1) }], NOW)
check('a failed send is an exception too', failedSend[0].tone === 'bad')

check('the literal string none counts as never sent',
  pendingPaperwork([{ ...base, work_order_status: 'none' }], NOW)[0].label === 'Never sent')
check('an unknown status is treated as outstanding rather than dropped',
  pendingPaperwork([{ ...base, work_order_status: 'weird' }], NOW).length === 1)

// --- a job can be waiting on both -------------------------------------------

const both = pendingPaperwork([{ ...base, agreement_status: null, work_order_status: null }], NOW)
check('two unsigned documents are two rows', both.length === 2)
check('but that is one job waiting', jobsWaiting(both) === 1)
check('and an empty list is nobody waiting', jobsWaiting([]) === 0)

// --- order, which decides what gets read ------------------------------------

const mixed = pendingPaperwork([
  { ...base, id: 'far', customer_name: 'Far', scheduled_date: '2026-09-30', work_order_status: null },
  { ...base, id: 'soon', customer_name: 'Soon', scheduled_date: '2026-09-10', work_order_status: null },
  // undated, so its work order is gated. Its agreement is what lists.
  { ...base, id: 'none', customer_name: 'Undated', scheduled_date: null, created_at: daysAgo(90), agreement_status: null },
  { ...base, id: 'past', customer_name: 'Overdue', scheduled_date: '2026-09-01', work_order_status: null },
], NOW)

check('the overdue install leads', mixed[0].customer_name === 'Overdue')
check('then the nearest date', mixed[1].customer_name === 'Soon')
check('then the furthest date', mixed[2].customer_name === 'Far')
check('and an undated job sorts last however long it has waited',
  mixed[3].customer_name === 'Undated', 'nothing is booked against it')

// --- the words on screen ----------------------------------------------------

check('a wait of one day is singular', waitedLabel({ waitedDays: 1 }) === '1 day')
check('a wait of three days is plural', waitedLabel({ waitedDays: 3 }) === '3 days')
check('a wait of zero is today, not "0 days"', waitedLabel({ waitedDays: 0 }) === 'today')
check('an unknown wait is blank, not zero', waitedLabel({ waitedDays: null }) === '')

check('an install today says so', installLabel({ untilInstall: 0 }) === 'Installs today')
check('tomorrow says so', installLabel({ untilInstall: 1 }) === 'Installs tomorrow')
check('further out counts days', installLabel({ untilInstall: 5 }) === 'In 5 days')
check('a past date is overdue, not negative',
  installLabel({ untilInstall: -2 }) === '2 days overdue')
check('no date says no date', installLabel({ untilInstall: null }) === 'No date yet')

check('inside two days is urgent', isUrgent({ untilInstall: 2 }) === true)
check('overdue is urgent', isUrgent({ untilInstall: -1 }) === true)
check('a fortnight out is not', isUrgent({ untilInstall: 14 }) === false)
check('an undated job is never urgent', isUrgent({ untilInstall: null }) === false)
check('overdue is past the date, not merely close', isOverdue({ untilInstall: -1 }) === true
  && isOverdue({ untilInstall: 0 }) === false && isOverdue({ untilInstall: 2 }) === false)
check('an undated job is never overdue', isOverdue({ untilInstall: null }) === false)

// --- the gate: only documents somebody could actually send -------------------

// The rule is not written twice. This is workOrderBlocker, the same function
// the send button reads, so the panel can never list work the button refuses.

const noDate = pendingPaperwork([{ ...base, scheduled_date: null, work_order_status: null }], NOW)
check('an unscheduled job does not list its work order', noDate.length === 0)
check('but it is counted as not ready rather than forgotten', noDate.notReady.length === 1)
check('and the count carries the reason',
  /no date/i.test(noDate.notReady[0].reason), noDate.notReady[0].reason)

check('no crew means nobody is sitting on it',
  pendingPaperwork([{ ...base, installer_id: null, installer_email: null, work_order_status: null }], NOW)
    .length === 0)
check('a crew with no email cannot be sent to',
  pendingPaperwork([{ ...base, installer_email: null, work_order_status: null }], NOW).length === 0)
check('no payout means the work order cannot go out',
  pendingPaperwork([{ ...base, installer_pay: 0, work_order_status: null }], NOW).length === 0)
check('an empty build sheet means the work order cannot go out',
  pendingPaperwork([{ ...base, template_line_count: 0, work_order_status: null }], NOW).length === 0)
check('no build sheet at all, likewise',
  pendingPaperwork([{ ...base, template_id: null, work_order_status: null }], NOW).length === 0)

check('no job number means the work order cannot go out',
  pendingPaperwork([{ ...base, invoice_number: null, work_order_status: null }], NOW).length === 0)

check('a customer agreement with no email is not waiting on anyone',
  pendingPaperwork([{ ...base, customer_email: null, agreement_status: null }], NOW).length === 0)
check('with an email it is', pendingPaperwork([{ ...base, agreement_status: null }], NOW).length === 1)

// The gate applies to unsent documents only. One already out is sitting in
// somebody's inbox whatever has happened to the job since.
const sentThenBroken = pendingPaperwork([{
  ...base, work_order_status: 'sent', work_order_sent_at: daysAgo(4),
  installer_id: null, installer_email: null, scheduled_date: null,
}], NOW)
check('a sent work order still lists after the crew is cleared', sentThenBroken.length === 1)
check('and is not counted as not ready', sentThenBroken.notReady.length === 0)
check('a declined document lists however unsendable the job is now',
  pendingPaperwork([{ ...base, agreement_status: 'declined', customer_email: null }], NOW).length === 1)

// --- rubbish in --------------------------------------------------------------

check('a bad sent date is unknown rather than NaN',
  pendingPaperwork([{ ...base, work_order_status: 'sent', work_order_sent_at: 'nonsense' }], NOW)[0]
    .waitedDays === null)
check('a bad scheduled date does not throw',
  pendingPaperwork([{ ...base, scheduled_date: 'nonsense', work_order_status: null }], NOW)[0]
    .untilInstall === null)
check('a future sent date never reads as negative days',
  pendingPaperwork([{ ...base, work_order_status: 'sent', work_order_sent_at: daysAgo(-5) }], NOW)[0]
    .waitedDays === 0)
check('a job with no name still renders',
  pendingPaperwork([{ ...base, customer_name: null, work_order_status: null }], NOW)[0]
    .customer_name === 'Unnamed job')

console.log('')
if (failed > 0) {
  console.error(`${failed} paperwork check(s) failed.`)
  process.exit(1)
}
console.log('All paperwork checks passed.')
