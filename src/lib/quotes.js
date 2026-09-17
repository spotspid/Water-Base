import { QUOTED_STATUS } from './constants.js'

// Quotes that have gone to a customer and are waiting on a signature.
//
// A quoted job that was never sent is a draft, not a quote out: nobody is
// deciding on it. Counting it would make the tile a list of unfinished forms.

const DAY = 24 * 60 * 60 * 1000

function localDay(value) {
  const d = new Date(value)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Whole days since the quote was last sent, counted in calendar days where the
// viewer is, so a quote sent last night is 1 day old this morning.
export function daysSinceQuoteSent(job, now = new Date()) {
  if (!job?.quote_sent_at) return null
  const sent = localDay(job.quote_sent_at)
  if (!Number.isFinite(sent)) return null
  return Math.max(0, Math.round((localDay(now) - sent) / DAY))
}

export function quotesOut(jobs) {
  return (jobs || []).filter(job => job.status === QUOTED_STATUS && Boolean(job.quote_sent_at))
}

export function quoteSummary(jobs, now = new Date()) {
  const out = quotesOut(jobs)
  const ages = out.map(job => daysSinceQuoteSent(job, now)).filter(n => n != null)
  return {
    count: out.length,
    value: out.reduce((sum, job) => sum + (Number(job.sale_price) || 0), 0),
    oldestDays: ages.length ? Math.max(...ages) : null,
  }
}
