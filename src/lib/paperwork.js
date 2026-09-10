// Documents standing between a sold job and a van turning up.
//
// A job does not stall on parts nearly as often as it stalls on a signature.
// The customer agreement is what makes the sale real, and the work order is
// what makes the installer real, and either one sitting unsent or unsigned
// stops the job just as dead as an empty shelf.
//
// Pure apart from workOrder.js, which is itself pure, so npm run check can
// still run all of it under Node.

import { workOrderBlocker } from './workOrder.js'
import { BLOCKED, documentRows } from './documents.js'

export const CUSTOMER = 'customer_install'
export const WORK_ORDER = 'subcontractor_service'

// A document is finished when it is signed. Everything else is outstanding,
// including a decline and a failed send, because both of those need somebody
// to do something today.
const SETTLED = ['completed']

const LABELS = {
  [CUSTOMER]: 'Customer agreement',
  [WORK_ORDER]: 'Work order',
}

function isoDay(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// Whole days between two dates, never negative. A clock a few seconds ahead of
// a timestamp must not produce "waiting -1 days".
function daysSince(value, now) {
  if (!value) return null
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86400000))
}

// Days until an install, which can be negative: a job whose date has passed
// and is still not installed is the most urgent thing on the page.
function daysUntil(day, now) {
  const value = String(day || '').slice(0, 10)
  if (!value) return null
  const target = new Date(`${value}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date(`${isoDay(now)}T00:00:00`)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

/**
 * What state one document is in, or null when there is nothing to chase.
 *
 * Null means signed. It does not mean unknown: a job with no row for a
 * document at all is reported as never sent, which is the honest reading and
 * the one that keeps a job that nobody has started from looking finished.
 */
function documentState(status, sentAt, createdAt, now) {
  const state = String(status || '').trim().toLowerCase()

  if (SETTLED.includes(state)) return null

  if (!state || state === 'none') {
    return {
      state: 'unsent',
      label: 'Never sent',
      tone: 'warn',
      // Nothing has been sent, so the wait is not the document's, it is the
      // job's: how long this has been sitting since it was written up.
      waitedDays: daysSince(createdAt, now),
      waitedFrom: 'written up',
    }
  }

  if (state === 'declined') {
    return { state: 'declined', label: 'Declined', tone: 'bad', waitedDays: daysSince(sentAt, now), waitedFrom: 'sent' }
  }

  if (state === 'failed') {
    return { state: 'failed', label: 'Send failed', tone: 'bad', waitedDays: daysSince(sentAt, now), waitedFrom: 'sent' }
  }

  return {
    state: 'unsigned',
    label: 'Sent, unsigned',
    tone: 'warn',
    waitedDays: daysSince(sentAt, now),
    waitedFrom: 'sent',
  }
}

/**
 * Why this document cannot go out yet, or '' when it can.
 *
 * The work order asks workOrderBlocker, which is the same function the send
 * button reads. Writing the rule again here would give the dashboard its own
 * opinion about what is sendable, and the first time the two drifted the panel
 * would be listing work nobody could actually do.
 *
 * The customer agreement has no equivalent module because it has no equivalent
 * rule: it needs an address to send to and nothing else, so that is checked
 * here rather than wrapped in a file of its own.
 */
function sendBlocker(job, type) {
  if (type === WORK_ORDER) return workOrderBlocker(job)

  return String(job?.customer_email || '').trim()
    ? ''
    : 'This job has no customer email, so there is nobody to send the agreement to.'
}

/**
 * Every outstanding document across every open job, worst first.
 *
 * One row per document rather than per job, because a job can be waiting on
 * both and they are chased separately: the customer signs one and the
 * installer signs the other.
 *
 * Installed and cancelled jobs are skipped. An unsigned work order on a job
 * that already happened is a filing problem, not something that stops work.
 */
export function pendingPaperwork(jobs, now = new Date()) {
  const out = []
  const skipped = []

  for (const job of jobs || []) {
    const status = String(job?.status || '').toLowerCase()
    if (status === 'installed' || status === 'cancelled') continue

    const untilInstall = daysUntil(job?.scheduled_date, now)

    const documents = [
      [CUSTOMER, job?.agreement_status, job?.agreement_sent_at],
      [WORK_ORDER, job?.work_order_status, job?.work_order_sent_at],
    ]

    for (const [type, docStatus, sentAt] of documents) {
      const state = documentState(docStatus, sentAt, job?.created_at, now)
      if (!state) continue

      // A document already out is waiting on a person whatever the job looks
      // like now. Clearing the crew after sending does not recall it from the
      // installer's inbox, so a sent row is never filtered.
      //
      // One never sent is different. If it could not go out today then nobody
      // is sitting on it, and listing it says somebody is being slow when the
      // truth is the job is not ready. That is the noise this panel replaced.
      if (state.state === 'unsent') {
        const blocker = sendBlocker(job, type)
        if (blocker) {
          skipped.push({ job_id: job?.id, type, reason: blocker })
          continue
        }
      }

      out.push({
        job_id: job?.id,
        customer_name: job?.customer_name || 'Unnamed job',
        type,
        document: LABELS[type],
        scheduled_date: job?.scheduled_date || null,
        untilInstall,
        installer_name: job?.installer_name || null,
        ...state,
      })
    }
  }

  out.sort(compare)
  // Carried on the array rather than returned separately, so a caller that
  // does not care about it is unaffected and one that does can say how many
  // documents are waiting on the job rather than on a person.
  //
  // Counted by the Documents page's own rule rather than from the rows this
  // loop skipped. The loop only walks open jobs, and the Documents page also
  // holds a work order on an installed job that nobody can send, so the two
  // counts read 7 and 8 for the same backlog. One rule, one number.
  out.notReady = notReadyDocuments(jobs, now, skipped)

  return out
}

// The documents the Documents page files under "Cannot send yet". Falls back
// to what this module skipped if that page's rule cannot answer, so a fault
// there never blanks the footnote here.
function notReadyDocuments(jobs, now, fallback) {
  try {
    return documentRows(jobs, now)
      .filter(row => row.section === BLOCKED)
      .map(row => ({ job_id: row.job_id, type: row.type, reason: row.reason }))
  } catch {
    return fallback
  }
}

/**
 * Which row matters more.
 *
 * An install date beats everything, because a document that has to be signed
 * by Thursday is more urgent than one that has been waiting a month with no
 * date on it. A job with no date sorts last however long it has waited, since
 * nothing is booked against it yet.
 */
function compare(a, b) {
  const aDated = a.untilInstall !== null
  const bDated = b.untilInstall !== null

  if (aDated !== bDated) return aDated ? -1 : 1
  if (aDated && a.untilInstall !== b.untilInstall) return a.untilInstall - b.untilInstall

  const aWait = a.waitedDays ?? -1
  const bWait = b.waitedDays ?? -1
  if (aWait !== bWait) return bWait - aWait

  return String(a.customer_name).localeCompare(String(b.customer_name), 'en', { sensitivity: 'base' })
}

// "3 days" / "1 day" / "today". Null stays null rather than becoming zero,
// because "waiting 0 days" and "we do not know when" are different claims.
export function waitedLabel(row) {
  const n = row?.waitedDays
  if (n === null || n === undefined) return ''
  if (n === 0) return 'today'
  return `${n} ${n === 1 ? 'day' : 'days'}`
}

// "installs Thursday" as a countdown, and the overdue case said plainly.
export function installLabel(row) {
  const n = row?.untilInstall
  if (n === null || n === undefined) return 'No date yet'
  if (n < 0) return `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'} overdue`
  if (n === 0) return 'Installs today'
  if (n === 1) return 'Installs tomorrow'
  return `In ${n} days`
}

// A dated job inside two days, or one already past its date, is the set
// worth colouring. Everything else is a queue, not a problem.
export function isUrgent(row) {
  const n = row?.untilInstall
  return n !== null && n !== undefined && n <= 2
}

// Past its date. Coloured harder than merely soon, because a van that has
// already been and gone with paperwork unsigned is a different problem from
// one leaving on Thursday.
export function isOverdue(row) {
  const n = row?.untilInstall
  return n !== null && n !== undefined && n < 0
}

// How many jobs, as opposed to how many documents. Two rows for one customer
// is one job stalled, not two.
export function jobsWaiting(rows) {
  return new Set((rows || []).map(r => r?.job_id).filter(Boolean)).size
}
