import {
  buildDeclined, buildNag, buildOrderArrived, buildSigned, buildViewed,
  documentLabel, jobLink, orderLink,
} from '../supabase/functions/notify/messages.ts'
import {
  NAG_WINDOW_DAYS, isBeingChased, isNagPaused, unsignedDocuments,
} from '../src/lib/nag.js'
import { SPECS, matchFields } from '../supabase/functions/send-agreement/fieldMap.ts'

// Checks what the notifier says and when it says it.
//
// Two things here are worth guarding. The first is the dedupe key, because it
// is the only thing standing between a DocuSeal retry and a customer's
// signature being announced twice, and between a doubled cron run and every
// job being nagged twice in a morning. It is a string, so a change to it is
// silent unless something asserts on it.
//
// The second is loudness. A signature and a decline are meant to interrupt
// someone; a view and a morning reminder are not. Getting that backwards makes
// the channel unusable inside a week, and nothing about the code would look
// wrong.
//
// Run with: npm run check:notifications
// No database, no Slack and no browser, so it runs anywhere.

let failed = 0

function check(name, condition, detail = '') {
  console.log((condition ? '  PASS  ' : '  FAIL  ') + name + (detail !== '' ? `  ${detail}` : ''))
  if (!condition) failed++
}

const JOB = {
  id: 'a8da94cd-ae94-433d-ae8e-eec2c6657a89',
  customer_name: 'Walter Radu',
  system_template: 'Flagship Bundle',
  sale_price: 2999,
}
const AG = '11111111-2222-3333-4444-555555555555'

// --- dedupe keys -----------------------------------------------------------

const signed = buildSigned(JOB, AG, 'customer_install')
const declined = buildDeclined(JOB, AG, 'customer_install')
const viewed = buildViewed(JOB, AG, 'customer_install', 1, '2026-08-25')

check('a signature keys on the document, so it fires once ever',
  signed.dedupe_key === `agreement.signed:${AG}`, signed.dedupe_key)
check('a DocuSeal retry computes the same key',
  buildSigned(JOB, AG, 'customer_install').dedupe_key === signed.dedupe_key)
check('signed and declined never collide', signed.dedupe_key !== declined.dedupe_key)
check('a view keys on the day, so a careful reader is not six messages',
  viewed.dedupe_key === `agreement.viewed:${AG}:2026-08-25`, viewed.dedupe_key)
check('two views the same day share a key',
  buildViewed(JOB, AG, 'customer_install', 5, '2026-08-25').dedupe_key === viewed.dedupe_key)
check('a view tomorrow does not',
  buildViewed(JOB, AG, 'customer_install', 6, '2026-08-26').dedupe_key !== viewed.dedupe_key)

const nagFacts = {
  job_id: JOB.id,
  customer_name: 'Walter Radu',
  days_until_install: 9,
  agreement_unsigned: true,
  agreement_days_unsigned: 9,
  agreement_status: 'sent',
  work_order_unsigned: false,
  work_order_days_unsigned: null,
  work_order_status: 'completed',
  installer_name: 'Anthony Thomas',
}

const nag = buildNag(nagFacts, '2026-08-25')
check('a nag keys on the job and the day, so the sweep can run twice',
  nag.dedupe_key === `nag.unsigned:${JOB.id}:2026-08-25`, nag.dedupe_key)
check('a second sweep the same day is a duplicate',
  buildNag(nagFacts, '2026-08-25').dedupe_key === nag.dedupe_key)
check('tomorrow is a fresh key',
  buildNag(nagFacts, '2026-08-26').dedupe_key !== nag.dedupe_key)

// --- loudness, graded on purpose -------------------------------------------

check('a decline interrupts everyone', declined.message.includes('<!channel>'))
check('and reads as urgent', declined.message.includes(':rotating_light:'))
check('and asks for something today', declined.message.includes('call today'))
check('a signature interrupts everyone', signed.message.includes('<!channel>'))
check('a view interrupts nobody', !viewed.message.includes('<!channel>'))
check('a view does not shout', !viewed.message.includes('*'))
check('a morning reminder interrupts nobody', !nag.message.includes('<!channel>'))

// --- channels --------------------------------------------------------------

check('signatures, declines and views all go to new sale',
  [signed, declined, viewed].every(m => m.channel === 'new_sale'))
check('the nag goes to scheduling', nag.channel === 'scheduling')

// --- every message stands alone, because webhooks cannot thread ------------

for (const m of [signed, declined, viewed, nag]) {
  check(`${m.event_type} names the job`, m.message.includes('Walter Radu'))
  check(`${m.event_type} links to the job`, m.message.includes(jobLink(JOB.id)))
  check(`${m.event_type} is short enough to read at a glance`,
    m.message.length < 400, String(m.message.length))
}

// --- the day count, which is the reason the nag exists ----------------------

const soon = buildNag({ ...nagFacts, days_until_install: 2, agreement_days_unsigned: 2 }, 'd')
const later = buildNag({ ...nagFacts, days_until_install: 14, agreement_days_unsigned: 14 }, 'd')
check('unsigned for 2 days reads differently from unsigned for 14',
  soon.message !== later.message)
check('two days out is marked', soon.message.includes(':warning:'))
check('fourteen days out is not', !later.message.includes(':warning:'))
check('installs today', buildNag({ ...nagFacts, days_until_install: 0 }, 'd').message.includes('installs today'))
check('installs tomorrow', buildNag({ ...nagFacts, days_until_install: 1 }, 'd').message.includes('installs tomorrow'))
check('a document that was never sent says so, rather than unsigned for null days',
  buildNag({ ...nagFacts, agreement_status: null, agreement_days_unsigned: null }, 'd')
    .message.includes('never sent'))
check('sent today does not read as unsigned for 0 days',
  buildNag({ ...nagFacts, agreement_days_unsigned: 0 }, 'd').message.includes('sent today'))
check('a signed document is left out of the reminder', !nag.message.includes('Work order'))
check('both outstanding are listed under one message',
  (() => {
    const both = buildNag({
      ...nagFacts, work_order_unsigned: true, work_order_status: 'sent', work_order_days_unsigned: 3,
    }, 'd')
    return both.message.includes('Customer agreement')
      && both.message.includes('Work order for Anthony Thomas')
      && both.dedupe_key === `nag.unsigned:${JOB.id}:d`
  })())

// --- missing facts must not produce a broken message ------------------------

const bare = buildSigned({ id: 'j1' }, 'a1', 'customer_install')
check('a job with no name still reads', bare.message.includes('An unnamed job'))
check('a zero price is left out rather than printed as $0',
  !buildSigned({ id: 'j1', customer_name: 'A', sale_price: 0 }, 'a1', 'customer_install')
    .message.includes('$0'))
check('document labels', documentLabel('customer_install') === 'customer agreement'
  && documentLabel('subcontractor_service') === 'work order')

// --- the pause, which has to agree with the SQL exactly ---------------------

const NOW = new Date(2026, 7, 25)

check('the window is 14 days', NAG_WINDOW_DAYS === 14)
check('paused until tomorrow is quiet', isNagPaused({ nag_snoozed_until: '2026-08-26' }, NOW))
// The view says nag_snoozed_until <= today means nag. If the button disagreed
// it would claim a job was quiet while Slack carried on posting about it.
check('paused until today is over, matching the SQL boundary',
  !isNagPaused({ nag_snoozed_until: '2026-08-25' }, NOW))
check('no pause set is not paused', !isNagPaused({}, NOW))
check('day 14 is inside the window', isBeingChased({ scheduled_date: '2026-09-08' }, NOW))
check('day 15 is outside it', !isBeingChased({ scheduled_date: '2026-09-09' }, NOW))
check('yesterday is outside it', !isBeingChased({ scheduled_date: '2026-08-24' }, NOW))
check('the window crosses a month end',
  isBeingChased({ scheduled_date: '2026-09-05' }, new Date(2026, 7, 31)))
check('nothing sent means both documents outstanding', unsignedDocuments({}).length === 2)
check('both signed means nothing outstanding, which is what stops the reminder',
  unsignedDocuments({ agreement_status: 'completed', work_order_status: 'completed' }).length === 0)
check('sent is not signed',
  unsignedDocuments({ agreement_status: 'sent', work_order_status: 'completed' }).length === 1)

// --- a supplier order landing ------------------------------------------------

const ORDER = {
  id: '99999999-8888-7777-6666-555555555555',
  supplier: 'Honest',
  order_number: 'QB-20104',
  line_count: 10,
  units_received: 34,
  order_total: 10561.05,
}

const arrived = buildOrderArrived(ORDER)

check('an arrival goes to the stock channel', arrived.channel === 'stock')
check('and keys on the order, so a status correction cannot announce it twice',
  arrived.dedupe_key === `order.received:${ORDER.id}`, arrived.dedupe_key)
check('an arrival interrupts nobody', !arrived.message.includes('<!channel>'))
check('it names the order', arrived.message.includes('QB-20104'))
check('and the supplier', arrived.message.includes('Honest'))
check('and says the stock is usable', arrived.message.includes('free to sell'))
check('and carries the landed total', arrived.message.includes('$10,561.05'))
check('and links to the order', arrived.message.includes(orderLink(ORDER.id)), orderLink(ORDER.id))
check('an order link is not a job link', !arrived.message.includes('/jobs?job='))
check('it is short enough to read at a glance', arrived.message.length < 400)

// a bare order still has to produce something readable
const bareOrder = buildOrderArrived({ id: 'o1' })
check('an order with no supplier or number still reads',
  bareOrder.message.includes('A supplier order'), bareOrder.message)
check('a zero total is left out rather than printed as $0',
  !buildOrderArrived({ id: 'o1', order_total: 0 }).message.includes('$0'))
check('a zero line count is left out rather than printed',
  !buildOrderArrived({ id: 'o1', line_count: 0, units_received: 0 }).message.includes('0 line'))
check('one line is singular',
  buildOrderArrived({ id: 'o1', line_count: 1, units_received: 1 }).message.includes('1 line, 1 unit'))
check('an order notification carries no job id', arrived.job_id === '')

// --- the balance the installer is told to collect ----------------------------

// The nineteen names template 5532104 is known to carry. There is no balance
// box on it yet, so the field has to be optional: adding one in DocuSeal
// should start filling it, and not adding one must not break the send.
const WO_TEMPLATE = [
  'job_number', 'date_issued', 'subcontractor', 'customer_name', 'phone',
  'install_address', 'city', 'scheduled_window', 'systems', 'site_conditions',
  'additional_items', 'agreed_pay', 'payment_terms',
  'collected_by_company', 'collected_by_subcontractor',
  'company_signature', 'company_date',
  'subcontractor_signature', 'subcontractor_date',
]

const woCtx = {
  job: {
    customer_name: 'Walter Radu', address: '4120 Maple Ridge Dr', city: 'Novi',
    system_template: 'Flagship Bundle', ro_type: 'Tank Style', faucet_finish: 'Chrome',
    invoice_number: '5901', scheduled_date: '2026-09-08', installer_pay: 450,
    deposits_taken: 500, balance_due: 2499,
  },
  installer: { name: 'Anthony Thomas', email: 'a@example.com' },
  parts: [{ sku: 'MB-1054', name: 'Mixed Bed', quantity: 1 }],
  today: new Date(2026, 7, 25),
}

const woSpec = SPECS.subcontractor_service
const asIs = matchFields(woSpec, WO_TEMPLATE, woCtx)

check('the work order still sends against a template with no balance box',
  asIs.missing.length === 0)
check('and does not invent one', !asIs.fields.some(f => f.name === 'balance_due'))
check('still exactly two fields left for the installer to fill',
  asIs.openToSigner.length === 2)

const withBox = matchFields(woSpec, [...WO_TEMPLATE, 'balance_due'], woCtx)
const woBy = new Map(withBox.fields.map(f => [f.name, f]))
check('adding a balance_due box starts filling it with no code change',
  woBy.get('balance_due')?.default_value === '$2,499.00', woBy.get('balance_due')?.default_value)
check('locked, like every other prefilled field', woBy.get('balance_due')?.readonly === true)
check('and it sits beside the collected by boxes',
  woBy.get('collected_by_company')?.default_value === 'X')

const paidInFull = matchFields(woSpec, [...WO_TEMPLATE, 'balance_due'], {
  ...woCtx, job: { ...woCtx.job, deposits_taken: 2999, balance_due: 0 },
})
check('paid in full prints $0.00, because nothing to collect is an instruction',
  new Map(paidInFull.fields.map(f => [f.name, f])).get('balance_due')?.default_value === '$0.00')

// Number(null) is 0, so a balance nobody could work out would print as $0.00
// and send an installer away empty handed from a job that owes money.
const unknownBalance = matchFields(woSpec, [...WO_TEMPLATE, 'balance_due'], {
  ...woCtx, job: { ...woCtx.job, balance_due: null },
})
check('an unknown balance leaves the box open rather than claiming zero',
  !unknownBalance.fields.some(f => f.name === 'balance_due'))
check('and does not block the send', unknownBalance.missing.length === 0)

console.log(failed === 0
  ? '\nAll notification checks passed.'
  : `\n${failed} notification check(s) failed.`)

process.exit(failed === 0 ? 0 : 1)
