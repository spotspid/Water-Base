// What each notification actually says.
//
// Kept apart from the sending so the wording can be tested without a webhook,
// a database or a deploy. Every function here is pure: facts in, one string
// out.
//
// Incoming webhooks cannot thread and cannot be edited, so every message has
// to stand on its own. That means each one names the job and carries a link,
// because a line that says "unsigned for 9 days" with no name is a line
// nobody can act on.
//
// Which channel a DocuSeal event lands in follows who signed, not what the
// event was. A customer signing is a sale. A contractor signing a work order
// is operations, and the daily reminder chasing that same signature already
// goes to scheduling, so putting the outcome anywhere else splits one
// conversation across two rooms.
//
// Loudness is deliberate and graded, and it follows the channel as well as the
// event. An at-channel earns its keep in the sales room, where a signature or a
// decline changes somebody's day. In scheduling it would land beside a quiet
// daily reminder and be louder than the news deserves, so work order events
// carry the emoji and the bold and skip the mention.
//
//   declined  a siren, and someone has to phone today.
//   signed    a tick. Money arrived, or a crew is confirmed.
//   viewed    no emoji and no bold. It is a breadcrumb, not news.
//   nag       no mention. It arrives every morning, and a daily <!channel>
//             would train everyone to mute the channel inside a week.
//   arrived   no mention. Stock landing is good news, and good news that
//             pings twelve people is still a ping.

export type Channel = 'new_sale' | 'scheduling' | 'stock'

export type JobFacts = {
  id: string
  customer_name?: string | null
  system_template?: string | null
  sale_price?: number | string | null
  city?: string | null
}

export type NagFacts = {
  job_id: string
  customer_name?: string | null
  system_template?: string | null
  days_until_install: number
  agreement_unsigned: boolean
  agreement_days_unsigned: number | null
  agreement_status?: string | null
  work_order_unsigned: boolean
  work_order_days_unsigned: number | null
  work_order_status?: string | null
  installer_name?: string | null
}

export type OrderFacts = {
  id: string
  supplier?: string | null
  order_number?: string | null
  line_count?: number | null
  units_received?: number | null
  order_total?: number | string | null
}

export type Built = {
  channel: Channel
  event_type: string
  message: string
  dedupe_key: string
  job_id: string
  payload: Record<string, unknown>
}

const DEFAULT_APP_URL = 'https://water-base.vercel.app'

function appBase(appUrl?: string): string {
  return String(appUrl || DEFAULT_APP_URL).replace(/\/+$/, '')
}

export function jobLink(jobId: string, appUrl = DEFAULT_APP_URL): string {
  return `${appBase(appUrl)}/jobs?job=${encodeURIComponent(jobId)}`
}

export function orderLink(orderId: string, appUrl = DEFAULT_APP_URL): string {
  return `${appBase(appUrl)}/orders?order=${encodeURIComponent(orderId)}`
}

function name(job: { customer_name?: string | null }): string {
  const n = String(job.customer_name || '').trim()
  return n || 'An unnamed job'
}

function money(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n === 0) return ''
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

// "Flagship Bundle, $2,999" with either half allowed to be missing
function subtitle(job: JobFacts): string {
  return [String(job.system_template || '').trim(), money(job.sale_price)]
    .filter(Boolean)
    .join(', ')
}

// "1 day" / "3 days", and the two cases a count of zero has to cover
function days(n: number | null, zero: string): string {
  if (n === null || !Number.isFinite(n)) return ''
  if (n <= 0) return zero
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

const LABELS: Record<string, string> = {
  customer_install: 'customer agreement',
  subcontractor_service: 'work order',
}

export function documentLabel(type: string): string {
  return LABELS[type] || 'document'
}

/**
 * Where a document event belongs.
 *
 * The work order is chased in scheduling by the morning sweep, so its outcome
 * belongs there too: the message saying it came back signed lands beside the
 * messages that were asking for it. Everything else is a customer document and
 * is news for the sales channel.
 */
export function channelForDocument(agreementType: string): Channel {
  return agreementType === 'subcontractor_service' ? 'scheduling' : 'new_sale'
}

// Whether an event about this document should interrupt the room it lands in.
// Only the sales channel gets a mention: a work order coming back signed is
// good to know, not something to pull twelve people out of what they are doing.
function mentionFor(agreementType: string): string {
  return channelForDocument(agreementType) === 'new_sale' ? '<!channel> ' : ''
}

/* ---------------------------------------------------------------------------
   DocuSeal events, all to the new sale channel
--------------------------------------------------------------------------- */

// Once ever, per document. A DocuSeal retry carries the same agreement, so it
// computes the same key and is dropped rather than posted twice.
export function buildSigned(
  job: JobFacts, agreementId: string, agreementType: string, appUrl?: string,
): Built {
  const doc = documentLabel(agreementType)
  const detail = subtitle(job)

  return {
    channel: channelForDocument(agreementType),
    event_type: 'agreement.signed',
    dedupe_key: `agreement.signed:${agreementId}`,
    job_id: job.id,
    payload: { agreement_id: agreementId, agreement_type: agreementType },
    message: [
      `${mentionFor(agreementType)}:white_check_mark: *Signed* ${name(job)}`,
      `The ${doc} came back signed${detail ? `. ${detail}` : ''}.`,
      `<${jobLink(job.id, appUrl)}|Open the job>`,
    ].join('\n'),
  }
}

// The one that has to interrupt someone. A decline is a sale coming apart, and
// the window to save it is hours rather than days.
export function buildDeclined(
  job: JobFacts, agreementId: string, agreementType: string, appUrl?: string,
): Built {
  const doc = documentLabel(agreementType)
  const detail = subtitle(job)
  const who = agreementType === 'subcontractor_service' ? 'The installer' : 'The customer'

  return {
    channel: channelForDocument(agreementType),
    event_type: 'agreement.declined',
    dedupe_key: `agreement.declined:${agreementId}`,
    job_id: job.id,
    payload: { agreement_id: agreementId, agreement_type: agreementType },
    message: [
      `${mentionFor(agreementType)}:rotating_light: *DECLINED* ${name(job)}`,
      `${who} declined the ${doc}${detail ? `. ${detail}` : ''}. This needs a call today.`,
      `<${jobLink(job.id, appUrl)}|Open the job>`,
    ].join('\n'),
  }
}

// Quiet, and at most one a day per document.
//
// DocuSeal fires form.viewed every time the link is opened, so keying on the
// agreement alone would post once and never again, and keying on the view
// number would post six times when someone reads a contract carefully. The
// calendar day is the middle: you hear that they looked today, once. How many
// times in total is on the job record, which is where a count of four turns
// into a phone call.
export function buildViewed(
  job: JobFacts, agreementId: string, agreementType: string,
  viewCount: number, day: string, appUrl?: string,
): Built {
  const doc = documentLabel(agreementType)
  const times = viewCount > 1 ? `, ${viewCount} times now` : ''

  return {
    channel: channelForDocument(agreementType),
    event_type: 'agreement.viewed',
    dedupe_key: `agreement.viewed:${agreementId}:${day}`,
    job_id: job.id,
    payload: { agreement_id: agreementId, agreement_type: agreementType, view_count: viewCount },
    message: [
      `${name(job)} opened the ${doc}${times}. Not signed yet.`,
      `<${jobLink(job.id, appUrl)}|Open the job>`,
    ].join('\n'),
  }
}

/* ---------------------------------------------------------------------------
   The daily nag, to the scheduling channel
--------------------------------------------------------------------------- */

// One message per job per day. The key carries the calendar day, so the sweep
// can run twice for daylight saving, be retried after a failure, or be fired
// by hand during testing, and the job still hears about it once.
export function buildNag(facts: NagFacts, day: string, appUrl?: string): Built {
  const outstanding: string[] = []

  if (facts.agreement_unsigned) {
    outstanding.push(describeDocument(
      'Customer agreement', facts.agreement_status, facts.agreement_days_unsigned,
    ))
  }

  if (facts.work_order_unsigned) {
    const label = facts.installer_name ? `Work order for ${facts.installer_name}` : 'Work order'
    outstanding.push(describeDocument(
      label, facts.work_order_status, facts.work_order_days_unsigned,
    ))
  }

  const until = facts.days_until_install
  const when = until <= 0
    ? 'installs today'
    : until === 1 ? 'installs tomorrow' : `installs in ${until} days`

  // Two days out is the point where an unsigned document stops being a chore
  // and starts being a problem, so that is where the message gains a marker.
  const lead = until <= 2 ? ':warning: ' : ''

  return {
    channel: 'scheduling',
    event_type: 'nag.unsigned',
    dedupe_key: `nag.unsigned:${facts.job_id}:${day}`,
    job_id: facts.job_id,
    payload: {
      days_until_install: until,
      agreement_days_unsigned: facts.agreement_days_unsigned,
      work_order_days_unsigned: facts.work_order_days_unsigned,
    },
    message: [
      `${lead}*${name(facts)}* ${when}.`,
      outstanding.join('\n'),
      `<${jobLink(facts.job_id, appUrl)}|Open the job>`,
    ].filter(Boolean).join('\n'),
  }
}

// "Customer agreement unsigned for 9 days" / "never sent"
function describeDocument(
  label: string, status: string | null | undefined, daysUnsigned: number | null,
): string {
  if (!status) return `${label}: never sent.`
  if (status === 'failed') return `${label}: the last send failed.`
  if (status === 'declined') return `${label}: declined.`

  const age = days(daysUnsigned, 'sent today')

  if (!age) return `${label}: unsigned.`
  if (age === 'sent today') return `${label}: sent today, unsigned.`
  return `${label}: unsigned for ${age}.`
}


/* ---------------------------------------------------------------------------
   Supplier orders, to the stock channel
--------------------------------------------------------------------------- */

// "1 line" / "3 lines", where a missing count is left out rather than printed
// as a confident zero
function count(n: unknown, singular: string, plural = `${singular}s`): string {
  const v = Number(n)
  if (!Number.isFinite(v) || v <= 0) return ''
  return `${v} ${v === 1 ? singular : plural}`
}

// Fires once per order, when the last outstanding line is received.
//
// The point is that a shortage just ended, so the message names what landed
// rather than what it cost, and stays quiet: nobody needs interrupting because
// a delivery van turned up.
export function buildOrderArrived(order: OrderFacts, appUrl?: string): Built {
  const who = String(order.supplier || '').trim()
  const ref = String(order.order_number || '').trim()
  const title = [ref, who && `from ${who}`].filter(Boolean).join(' ') || 'A supplier order'

  const detail = [
    count(order.line_count, 'line'),
    count(order.units_received, 'unit'),
    money(order.order_total) && `${money(order.order_total)} landed`,
  ].filter(Boolean).join(', ')

  return {
    channel: 'stock',
    event_type: 'order.received',
    // once per order, ever. A status correction that flips it back and forth
    // must not announce the same delivery twice.
    dedupe_key: `order.received:${order.id}`,
    job_id: '',
    payload: { order_id: order.id, order_number: ref, supplier: who },
    message: [
      `:package: *Arrived* ${title}`,
      detail ? `${detail}. It is on the shelf and free to sell.` : 'It is on the shelf and free to sell.',
      `<${orderLink(order.id, appUrl)}|Open the order>`,
    ].join('\n'),
  }
}
