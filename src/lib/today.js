// What needs somebody today.
//
// The navy block at the top of the dashboard, and the only place in the app
// allowed to shout. It answers one question: which booked installs cannot go
// ahead as they stand.
//
// A job qualifies by having a date and something missing. Undated work is not
// urgent by definition, however long it has sat, because nothing is promised
// to a customer yet. That is what keeps this block short enough to read.
//
// Pure apart from workOrder.js, which is itself pure.

import { gapsSentence, workOrderGaps } from './workOrder.js'

// Beyond this a booked job is not today's problem. Two weeks is the same
// window the morning nag uses, so the two never disagree about what is close.
export const HORIZON_DAYS = 14

function isoDay(date) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function daysUntil(day, now) {
  const value = String(day || '').slice(0, 10)
  if (!value) return null
  const target = new Date(`${value}T00:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date(`${isoDay(now)}T00:00:00`)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

// Which rail the card gets. Red for a date already gone, amber for today,
// teal for anything still ahead. Nothing else earns a colour here.
function urgencyOf(days) {
  if (days < 0) return 'late'
  if (days === 0) return 'now'
  return 'soon'
}

function whenLabel(days) {
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`
  if (days === 0) return 'Installs today'
  if (days === 1) return 'Installs tomorrow'
  return `In ${days} days`
}

/**
 * One card per booked install that cannot go ahead, soonest first.
 *
 * The missing list comes from workOrderGaps, so the card and the send button
 * are reading one rule. A card that said "needs a payout" while the button
 * complained about a crew would be worse than no card.
 */
export function todayBlockers(jobs, now = new Date()) {
  const cards = []

  for (const job of jobs || []) {
    const status = String(job?.status || '').toLowerCase()
    if (status === 'installed' || status === 'cancelled') continue

    const days = daysUntil(job?.scheduled_date, now)
    if (days === null || days > HORIZON_DAYS) continue

    const gaps = workOrderGaps(job)
    if (gaps.length === 0) continue

    cards.push({
      job_id: job?.id,
      who: job?.customer_name || 'Unnamed job',
      days,
      urgency: urgencyOf(days),
      when: whenLabel(days),
      needs: gapsSentence(job),
      gapKeys: gaps.map(gap => gap.key),
    })
  }

  return cards.sort((a, b) => {
    if (a.days !== b.days) return a.days - b.days
    return String(a.who).localeCompare(String(b.who), 'en', { sensitivity: 'base' })
  })
}

// Only when something is genuinely past its date. The pulse is a siren, and a
// siren that runs every day is furniture.
export function hasOverdue(cards) {
  return (cards || []).some(card => card?.urgency === 'late')
}

/**
 * The headline, which names the single most common thing in the way.
 *
 * "Three installs are booked with no crew assigned" beats listing three names
 * the cards are about to list anyway. When the reasons differ it stays
 * general rather than picking one and misleading about the rest.
 */
export function todayHeadline(cards) {
  const list = cards || []

  if (list.length === 0) return { lead: 'Nothing is blocked.', emphasis: '' }

  const counts = {}
  for (const card of list) {
    for (const key of card.gapKeys || []) counts[key] = (counts[key] || 0) + 1
  }

  const [topKey, topCount] = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])[0] || ['', 0]

  const n = list.length
  const word = n === 1 ? 'one install is' : `${spell(n)} installs are`

  const PHRASE = {
    date: 'no date',
    crew: 'no crew assigned',
    crew_email: 'no email for the crew',
    sheet: 'no build sheet',
    sheet_parts: 'an empty build sheet',
    payout: 'no payout set',
    job_number: 'no job number',
  }

  // Only claim a shared cause when it really is shared by all of them.
  if (topCount === n && PHRASE[topKey]) {
    return { lead: `${capitalise(word)} booked with `, emphasis: PHRASE[topKey], tail: '.' }
  }

  return { lead: `${capitalise(word)} booked and `, emphasis: 'not ready to send', tail: '.' }
}

function capitalise(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Small numbers read better as words in a headline. Past ten the digit is
// clearer than the word.
function spell(n) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']
  return words[n] || String(n)
}
