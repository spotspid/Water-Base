// Every customer agreement and work order, across every job.
//
// The dashboard answers "what needs me today" and deliberately shows only what
// somebody is actually sitting on. This is the other half: the whole book,
// including the backlog that is nobody's fault yet, so there is one place that
// knows how much paperwork exists rather than only how much is urgent.
//
// Three sections, and the order is the argument. Cannot send comes first
// because it is the real backlog: a document nobody can send is not waiting on
// a person, it is waiting on the job, and that work is invisible everywhere
// else in the app.
//
// Pure apart from workOrder.js, which is itself pure.

import { workOrderBlocker, workOrderGaps } from './workOrder.js'

export const CUSTOMER = 'customer_install'
export const WORK_ORDER = 'subcontractor_service'

export const BLOCKED = 'blocked'
export const OUT = 'out'
export const SIGNED = 'signed'

export const SECTIONS = [
  { key: BLOCKED, title: 'Cannot send yet', note: 'Waiting on the job, not on a person' },
  { key: OUT, title: 'Out for signature', note: 'Sent and not signed back' },
  { key: SIGNED, title: 'Signed', note: 'Done and on file' },
]

// The same words the job modal, the dashboard and the Slack messages use.
// This page called it an install agreement for a while, which made one
// document look like two.
const LABELS = {
  [CUSTOMER]: 'Customer agreement',
  [WORK_ORDER]: 'Work order',
}

// The customer agreement has no rule module because it has no rule: it needs
// an address to send to and nothing else. Shaped like a work order gap so the
// grouping below does not need to know which is which.
const NO_EMAIL = {
  key: 'customer_email',
  short: 'a customer email',
  sentence: 'This job has no customer email, so there is nobody to send the agreement to.',
}

function isoDay(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function daysSince(value, now) {
  if (!value) return null
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86400000))
}

function daysUntil(day, now) {
  const value = String(day || '').slice(0, 10)
  if (!value) return null
  const target = new Date(`${value}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  return Math.round((target.getTime() - new Date(`${isoDay(now)}T00:00:00`).getTime()) / 86400000)
}

/**
 * Everything in the way of this document, or an empty list when nothing is.
 *
 * Work orders ask workOrderGaps, which is the same source the send button and
 * the dashboard read. Writing the rule again here would give this page its own
 * opinion about what is sendable, and the first time the two drifted the
 * backlog would be listing work the button says is fine.
 */
function gapsFor(job, type) {
  if (type === WORK_ORDER) return workOrderGaps(job)
  return String(job?.customer_email || '').trim() ? [] : [NO_EMAIL]
}

function stateOf(status) {
  const value = String(status || '').trim().toLowerCase()
  if (value === 'completed') return 'signed'
  if (!value || value === 'none') return 'unsent'
  if (value === 'declined') return 'declined'
  if (value === 'failed') return 'failed'
  return 'unsigned'
}

const STATE_LABEL = {
  signed: 'Signed',
  unsent: 'Not sent',
  declined: 'Declined',
  failed: 'Send failed',
  unsigned: 'Sent, unsigned',
}

const STATE_TONE = {
  signed: 'green',
  unsent: 'amber',
  declined: 'red',
  failed: 'red',
  unsigned: 'amber',
}

/**
 * One row per document per job, sorted and bucketed.
 *
 * A signed document is never blocked, whatever the job looks like now. Signing
 * is the end of the story, and reopening it because somebody later cleared the
 * crew would put finished work back in the backlog.
 */
export function documentRows(jobs, now = new Date()) {
  const rows = []

  for (const job of jobs || []) {
    const status = String(job?.status || '').toLowerCase()
    const cancelled = status === 'cancelled'

    const documents = [
      [CUSTOMER, job?.agreement_status, job?.agreement_sent_at],
      [WORK_ORDER, job?.work_order_status, job?.work_order_sent_at],
    ]

    for (const [type, docStatus, sentAt] of documents) {
      const state = stateOf(docStatus)
      const gaps = state === 'signed' ? [] : gapsFor(job, type)

      // Sent means it left the building. A document out for signature stays
      // out even if the job has since lost its crew, because it is still in
      // somebody's inbox and can still come back signed.
      const section = state === 'signed'
        ? SIGNED
        : (state === 'unsent' && (gaps.length > 0 || cancelled)) ? BLOCKED : OUT

      rows.push({
        job_id: job?.id,
        key: `${job?.id}-${type}`,
        customer_name: job?.customer_name || 'Unnamed job',
        installer_name: job?.installer_name || null,
        job_status: status,
        type,
        document: LABELS[type],
        state,
        label: STATE_LABEL[state],
        tone: STATE_TONE[state],
        section,
        gaps,
        reason: cancelled && gaps.length === 0
          ? 'This job is cancelled.'
          : (gaps[0]?.sentence || (type === WORK_ORDER ? workOrderBlocker(job) : '')),
        reasonKey: cancelled && gaps.length === 0 ? 'cancelled' : (gaps[0]?.key || ''),
        reasonShort: cancelled && gaps.length === 0 ? 'Job is cancelled' : (gaps[0]?.short || ''),
        sentDays: daysSince(sentAt, now),
        untilInstall: daysUntil(job?.scheduled_date, now),
        scheduled_date: job?.scheduled_date || null,
      })
    }
  }

  return rows
}

/**
 * The blocked rows, grouped by what is blocking them.
 *
 * Grouped rather than listed flat because the backlog is not fourteen separate
 * problems, it is three: nine jobs need a crew, four need a payout, one has an
 * empty build sheet. Seeing that is what turns a list into an afternoon of
 * work with an order to it.
 */
export function groupByReason(rows) {
  const groups = new Map()

  for (const row of rows || []) {
    if (row.section !== BLOCKED) continue

    const key = row.reasonKey || 'other'
    if (!groups.has(key)) {
      groups.set(key, { key, short: row.reasonShort || 'Something else', rows: [] })
    }
    groups.get(key).rows.push(row)
  }

  return [...groups.values()]
    .map(group => ({ ...group, rows: group.rows.sort(byUrgency) }))
    .sort((a, b) => b.rows.length - a.rows.length || a.short.localeCompare(b.short))
}

// A dated job beats an undated one, then the nearer date, then the name.
function byUrgency(a, b) {
  const aDated = a.untilInstall !== null
  const bDated = b.untilInstall !== null

  if (aDated !== bDated) return aDated ? -1 : 1
  if (aDated && a.untilInstall !== b.untilInstall) return a.untilInstall - b.untilInstall

  return String(a.customer_name).localeCompare(String(b.customer_name), 'en', { sensitivity: 'base' })
}

export function inSection(rows, section) {
  return (rows || []).filter(row => row.section === section).sort(byUrgency)
}

// Counts for the cards at the top. Total is documents, not jobs: a job waiting
// on both is two pieces of paper and two things to do.
export function documentCounts(rows) {
  const list = rows || []
  return {
    total: list.length,
    blocked: list.filter(r => r.section === BLOCKED).length,
    out: list.filter(r => r.section === OUT).length,
    signed: list.filter(r => r.section === SIGNED).length,
  }
}

export function installLabel(row) {
  const n = row?.untilInstall
  if (n === null || n === undefined) return 'No date'
  if (n < 0) return `${Math.abs(n)} ${Math.abs(n) === 1 ? 'day' : 'days'} overdue`
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  return `In ${n} days`
}

export function sentLabel(row) {
  const n = row?.sentDays
  if (n === null || n === undefined) return ''
  if (n === 0) return 'Sent today'
  return `Sent ${n} ${n === 1 ? 'day' : 'days'} ago`
}
