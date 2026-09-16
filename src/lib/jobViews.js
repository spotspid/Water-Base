import { soldNotBooked } from './dashboard.js'

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
}

export function jobViewOf(key) {
  return Object.hasOwn(JOB_VIEWS, key) ? JOB_VIEWS[key] : null
}

export function jobViewLink(key) {
  return `/jobs?view=${encodeURIComponent(key)}`
}
