import { soldNotBooked } from './dashboard.js'
import { attentionReasons, needsAttention } from './attention.js'
import { daysSinceQuoteSent, quotesOut } from './quotes.js'

// Named lists a link can open the jobs page on.
//
// A dashboard tile that shows a count has to lead to the jobs behind it, and
// the list it leads to has to be the count. So a view does not describe its
// jobs in its own words: it names the very function the tile counts with, and
// the jobs page runs that function over the same rows. The number and the list
// cannot drift apart, because there is only one rule.
export const JOB_VIEWS = {
  'not-booked': {
    title: 'Sold, not booked',
    filter: soldNotBooked,
    describe: count => `${count} sold ${count === 1 ? 'job is' : 'jobs are'} waiting on a date.`,
    empty: 'Every sold job has a date, so there is nothing waiting to be booked.',
  },
  // Each row says why it is here, because a list of names with no reason is a
  // list nobody can work through.
  // Sent and not signed, oldest first is how somebody works a list of calls.
  quotes: {
    title: 'Quotes out',
    filter: jobs => [...quotesOut(jobs)]
      .sort((a, b) => String(a.quote_sent_at).localeCompare(String(b.quote_sent_at))),
    reasonFor: job => {
      const days = daysSinceQuoteSent(job)
      return days == null ? '' : `Sent ${days} ${days === 1 ? 'day' : 'days'} ago, not signed`
    },
    describe: count => `${count} ${count === 1 ? 'quote is' : 'quotes are'} with customers and not signed.`,
    empty: 'No quotes are waiting on a signature.',
  },
  attention: {
    title: 'Needs attention',
    filter: needsAttention,
    reasonFor: job => attentionReasons(job).join('. '),
    describe: count => `${count} ${count === 1 ? 'job is' : 'jobs are'} missing something that`
      + ' affects the money or the paperwork. Open one to fix it.',
    empty: 'Nothing is missing on any open job.',
  },
}

export function jobViewOf(key) {
  return Object.hasOwn(JOB_VIEWS, key) ? JOB_VIEWS[key] : null
}

export function jobViewLink(key) {
  return `/jobs?view=${encodeURIComponent(key)}`
}
