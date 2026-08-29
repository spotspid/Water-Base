import {
  buildDeclined, buildNag, buildOrderArrived, buildSigned, buildViewed,
  channelForDocument, documentLabel, jobLink, orderLink,
} from '../supabase/functions/notify/messages.ts'
import {
  NAG_WINDOW_DAYS, isBeingChased, isNagPaused, unsignedDocuments,
} from '../src/lib/nag.js'
import { SPECS, matchFields } from '../supabase/functions/send-agreement/fieldMap.ts'
import { agreedPay, workOrderBlocker } from '../src/lib/workOrder.js'

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

// --- channels, which follow who signed rather than what happened ------------

check('a customer signature is a sale', signed.channel === 'new_sale')
check('a customer decline is a sale', declined.channel === 'new_sale')
check('a customer view is a sale', viewed.channel === 'new_sale')

// The work order is chased in scheduling by the morning sweep, so its outcome
// belongs there too rather than splitting one conversation across two rooms.
const woSigned = buildSigned(JOB, AG, 'subcontractor_service')
const woDeclined = buildDeclined(JOB, AG, 'subcontractor_service')
const woViewed = buildViewed(JOB, AG, 'subcontractor_service', 1, '2026-08-25')

check('a work order signature is operations', woSigned.channel === 'scheduling')
check('a work order decline is operations', woDeclined.channel === 'scheduling')
check('a work order view is operations', woViewed.channel === 'scheduling')
check('and it lands in the same channel the nag chases it from',
  woSigned.channel === nag.channel)

check('routing follows the document type',
  channelForDocument('customer_install') === 'new_sale'
  && channelForDocument('subcontractor_service') === 'scheduling')
check('an unknown document type stays with the customer channel',
  channelForDocument('something_else') === 'new_sale')

// Routing must not change the wording or the keys.
check('a work order signature still names the right document',
  woSigned.message.includes('work order'))
check('and keys the same way, so the routing change cannot resend old events',
  woSigned.dedupe_key === signed.dedupe_key)

// The mention follows the room, not the event. Sales gets interrupted; the
// scheduling channel, which already carries a quiet daily reminder, does not.
check('a work order signature does not interrupt the room',
  !woSigned.message.includes('<!channel>'))
check('a work order decline does not either',
  !woDeclined.message.includes('<!channel>'))
check('but a work order decline still reads as urgent',
  woDeclined.message.includes(':rotating_light:') && woDeclined.message.includes('*DECLINED*'))
check('and a work order signature still reads as good news',
  woSigned.message.includes(':white_check_mark:') && woSigned.message.includes('*Signed*'))
check('a customer signature still interrupts the sales room',
  signed.message.includes('<!channel>'))
check('and a customer decline still does',
  declined.message.includes('<!channel>'))

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

// --- the customer agreement, against template 5520400 -----------------------

// The ten boxes the template actually carries. It is exact match now, so a
// rename in DocuSeal is an error rather than a silent blank.
const CI_TEMPLATE = [
  'customer_name', 'install_address', 'city', 'email', 'systems', 'sale_price',
  'customer_signature', 'company_signature', 'company_date',
]

const ciSpec = SPECS.customer_install
const ciCtx = {
  job: {
    customer_name: 'Steve Burgess', phone: '(248) 555-0100',
    customer_email: 'steve@example.com', address: '1 Test Street', city: 'Ann Arbor',
    system_template: 'RO Only', ro_type: 'Tankless', faucet_finish: 'Chrome',
    sale_price: 1499,
  },
  installer: null, parts: [], today: new Date(2026, 7, 25),
}

const ci = matchFields(ciSpec, CI_TEMPLATE, ciCtx)
const ciBy = new Map(ci.fields.map(f => [f.name, f]))

check('the customer agreement sends against the real template', ci.missing.length === 0,
  ci.missing.join('; '))
check('customer name fills', ciBy.get('customer_name')?.default_value === 'Steve Burgess')
check('email fills', ciBy.get('email')?.default_value === 'steve@example.com')
check('sale price fills as money', ciBy.get('sale_price')?.default_value === '$1,499.00')
check('systems carries the picks',
  ciBy.get('systems')?.default_value === 'RO Only (Tankless, Chrome)',
  ciBy.get('systems')?.default_value)
check('the company countersignature is prefilled',
  ciBy.get('company_signature')?.default_value === 'Steve Burgess')
check('and dated', Boolean(ciBy.get('company_date')?.default_value))

// The template carries a city box of its own, so the address is the street
// alone. Putting the city in both would print it twice, and leaving the city
// box empty would leave a required field nobody may type in.
check('the address is the street only',
  ciBy.get('install_address')?.default_value === '1 Test Street')
check('and the city goes in the city box',
  ciBy.get('city')?.default_value === 'Ann Arbor')

// Everything readonly except the two the customer signs.
check('only two fields are left open', ci.openToSigner.length === 1 || ci.openToSigner.length === 2,
  ci.openToSigner.join(','))
check('and the customer signature is one of them',
  ci.openToSigner.includes('customer_signature'))
check('every other field is locked',
  ci.fields.filter(f => !f.readonly).every(f => f.name.startsWith('customer_')))
check('the company countersignature is locked',
  ciBy.get('company_signature')?.readonly === true)

// Boxes the template does not carry today must not block the send.
check('no phone box does not block the send',
  !ci.fields.some(f => f.name === 'phone') && ci.missing.length === 0)
check('adding a phone box starts filling it',
  matchFields(ciSpec, [...CI_TEMPLATE, 'phone'], ciCtx)
    .fields.find(f => f.name === 'phone')?.default_value === '(248) 555-0100')
check('naming the customer date box opens it to the signer',
  matchFields(ciSpec, [...CI_TEMPLATE, 'customer_date'], ciCtx)
    .openToSigner.includes('customer_date'))

// Exact matching, so the prose names the old template used are now errors.
check('a prose renamed box is reported rather than guessed at',
  matchFields(ciSpec, CI_TEMPLATE.map(n => (n === 'customer_name' ? 'Customer Name' : n)), ciCtx)
    .missing.length === 1)

// The two documents must describe the same sale in the same words.
check('systems reads the same on both documents',
  ciBy.get('systems')?.default_value
  === matchFields(SPECS.subcontractor_service, ['systems'], ciCtx)
    .fields.find(f => f.name === 'systems')?.default_value)

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
  'parts_list', 'agreed_pay', 'payment_terms',
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

// The parts box was renamed when the template was rebuilt. Both names are
// carried so a template restored from a backup still fills, and only one of
// them can exist on a given document.
const renamed = matchFields(woSpec, WO_TEMPLATE, woCtx)
check('the parts list fills under the new name parts_list',
  renamed.fields.some(f => f.name === 'parts_list'))
check('and still fills under the old name if a template carries it',
  matchFields(woSpec,
    WO_TEMPLATE.map(n => (n === 'parts_list' ? 'additional_items' : n)), woCtx)
    .fields.some(f => f.name === 'additional_items'))
check('a template carrying neither does not block the send',
  matchFields(woSpec, WO_TEMPLATE.filter(n => n !== 'parts_list'), woCtx).missing.length === 0)

// --- agreed pay, which the installer must never be able to type -------------

// He was being handed an open input to set his own pay. The field is now sent
// whether or not there is a figure, so the worst case is a box nobody can
// write in rather than an editable one.
const payCtx = amount => ({ ...woCtx, job: { ...woCtx.job, installer_pay: amount } })
const payField = amount =>
  matchFields(woSpec, WO_TEMPLATE, payCtx(amount)).fields.find(f => f.name === 'agreed_pay')

check('agreed pay is sent when there is a payout', Boolean(payField(450)))
check('and carries the figure', payField(450)?.default_value === '$450.00', payField(450)?.default_value)
check('and is locked', payField(450)?.readonly === true)

check('agreed pay is still sent when there is no payout', Boolean(payField(0)),
  'omitting it is what left an open box on the document')
check('and is blank', payField(0)?.default_value === '')
check('and is still locked, which is the whole point', payField(0)?.readonly === true)
check('a null payout behaves the same as zero',
  payField(null)?.readonly === true && payField(null)?.default_value === '')

// The only two boxes the subcontractor may touch, whatever his pay is.
for (const amount of [450, 0, null]) {
  const open = matchFields(woSpec, WO_TEMPLATE, payCtx(amount)).openToSigner
  check(`with pay ${JSON.stringify(amount)} only the signature and date stay open`,
    open.length === 2 && open.every(n => n.startsWith('subcontractor_')), open.join(','))
}

// --- and the send is refused before it gets that far ------------------------

// The browser's copy of a rule the edge function also enforces. If these two
// disagree the button offers a send the server then refuses.
const sendable = {
  scheduled_date: '2026-09-08', installer_id: 'i1', installer_email: 'a@example.com',
  template_id: 't1', template_line_count: 5, installer_pay: 450,
}

check('a fully priced job is sendable', workOrderBlocker(sendable) === '')
check('no payout blocks the send',
  workOrderBlocker({ ...sendable, installer_pay: null }) !== '')
check('and the blocker names the payout',
  workOrderBlocker({ ...sendable, installer_pay: null }).includes('payout'))
check('and points at the job',
  workOrderBlocker({ ...sendable, installer_pay: null }).includes('on this job'))
check('a zero payout blocks it too, for the same reason',
  workOrderBlocker({ ...sendable, installer_pay: 0 }) !== '')
check('a negative payout blocks it',
  workOrderBlocker({ ...sendable, installer_pay: -50 }) !== '')

// An empty sheet resolves cleanly, because nothing to resolve cannot fail, so
// the unresolved check never catches it. The document would look finished and
// tell the installer to bring nothing.
check('an empty build sheet blocks the send',
  workOrderBlocker({ ...sendable, template_line_count: 0 }) !== '')
check('and the blocker names the sheet',
  workOrderBlocker({ ...sendable, template_line_count: 0, system_template: 'Custom' })
    .includes('Custom'))
check('and says what the document would do',
  workOrderBlocker({ ...sendable, template_line_count: 0 }).includes('bring nothing'))
check('a missing count reads as empty rather than as fine',
  workOrderBlocker({ ...sendable, template_line_count: undefined }) !== '')
check('no sheet at all still reports the sheet, not the empty sheet',
  workOrderBlocker({ ...sendable, template_id: null, template_line_count: 0 })
    .includes('no build sheet'))

check('agreedPay reads a real figure', agreedPay({ installer_pay: 450 }) === 450)
check('and reads zero as missing', agreedPay({ installer_pay: 0 }) === null)
check('and null as missing', agreedPay({ installer_pay: null }) === null)
check('and a missing job as missing', agreedPay(null) === null)

// The earlier blockers still come first, so somebody who has not scheduled the
// job is not sent off to fix a payout on a job that is not happening.
check('an unscheduled job reports the date, not the payout',
  workOrderBlocker({ ...sendable, scheduled_date: null, installer_pay: null }).includes('no date'))
check('a crewless job reports the crew, not the payout',
  workOrderBlocker({ ...sendable, installer_id: null, installer_pay: null }).includes('No installer'))

console.log(failed === 0
  ? '\nAll notification checks passed.'
  : `\n${failed} notification check(s) failed.`)

process.exit(failed === 0 ? 0 : 1)
