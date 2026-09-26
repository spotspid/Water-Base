import { Link } from 'react-router-dom'
import { formatCurrency } from '../lib/inventory'
import { jobViewLink } from '../lib/jobViews'
import StatGrid from './StatGrid'

const TILES = 7

// Five figures that answer "what needs doing", not "how did we do".
//
// Revenue is two tiles rather than one. A single month total added six signed
// contracts to one finished install and called the sum revenue, which is two
// different claims wearing one number: the six are owed to customers and have
// not consumed a part or paid an installer, while the one is delivered and has
// a real margin behind it. They are measured off different dates too, sold by
// the day it was written and installed by the day it happened, so a job sold
// in July and installed in August lands in the right month either way.
//
// The two overlap on purpose. A job written and installed in the same month is
// in both, because it was genuinely sold this month and genuinely delivered
// this month. The footer says how many are in both, so the pair never reads as
// a total that has been double counted.
//
// Margin is not here at all. With one install ever, no job has drawn parts or
// recorded a payout, so margin equalled revenue on every row and the
// percentage was always 100. It lives on Profit and loss, where the month
// range makes it mean something.
export default function DashboardMetrics({
  sold, installed, both = 0, monthName, notBooked, attention = 0, bookedSoon, bookingDays,
  inventoryValue, inventoryUnits, itemCount, unpricedItems = 0,
  quotes = { count: 0, value: 0, oldestDays: null },
}) {
  return (
    <StatGrid count={TILES} minWidth={180} gap={18} className="dash-metrics">
      <article className="dash-tile">
        <span className="dash-tile-label">Sold in {monthName}</span>
        <span className="dash-tile-value">{formatCurrency(sold.revenue)}</span>
        <span className="dash-tile-foot">
          {sold.count === 0
            ? 'Nothing written up yet this month'
            : `${sold.count} ${sold.count === 1 ? 'job' : 'jobs'} written up${both > 0 ? `, ${both} already installed` : ''}`}
        </span>
      </article>

      {/* A zero here is a fact, not a warning. The quiet rail keeps it from
          reading as a problem next to four tiles that are doing fine. */}
      <article className={installed.revenue > 0 ? 'dash-tile' : 'dash-tile dash-tile-quiet'}>
        <span className="dash-tile-label">Installed in {monthName}</span>
        <span className="dash-tile-value">{formatCurrency(installed.revenue)}</span>
        <span className="dash-tile-foot">
          {installed.count === 0
            ? 'Nothing installed yet this month'
            : `${installed.count} ${installed.count === 1 ? 'job' : 'jobs'} delivered and earned${both > 0 ? ', counted in both tiles' : ''}`}
        </span>
      </article>

      {/* Quotes with customers and not signed yet. Not revenue, which is why it
          is its own tile: a quote counted as sold would be a promise nobody
          made. Opens the same list, oldest first. */}
      <Link
        to="/quotes?view=out"
        className={quotes.oldestDays != null && quotes.oldestDays >= 10
          ? 'dash-tile dash-tile-link dash-tile-attention'
          : 'dash-tile dash-tile-link'}
      >
        <span className="dash-tile-label">Quotes out</span>
        <span className="dash-tile-value">{quotes.count}</span>
        <span className="dash-tile-foot">
          {quotes.count === 0
            ? 'No quotes waiting on a signature'
            : `${formatCurrency(quotes.value)}, oldest sent ${quotes.oldestDays} ${quotes.oldestDays === 1 ? 'day' : 'days'} ago`}
        </span>
      </Link>

      {/* A count you cannot open is a count you cannot act on. The link lands
          on the jobs list filtered by soldNotBooked, the same rule the number
          is counted with, so the list is always the number. */}
      <Link
        to={jobViewLink('not-booked')}
        className={notBooked > 0 ? 'dash-tile dash-tile-link dash-tile-attention' : 'dash-tile dash-tile-link'}
      >
        <span className="dash-tile-label">Sold, not booked</span>
        <span className="dash-tile-value">{notBooked}</span>
        <span className="dash-tile-foot">
          {notBooked === 0
            ? 'Every sold job has a date'
            : `${notBooked === 1 ? 'Job is' : 'Jobs are'} waiting on a date`}
        </span>
      </Link>

      {/* Jobs with something missing that distorts the money or blocks the
          paperwork. Opens the list with the reason on every row, counted and
          listed by the same needsAttention rule, so no job drops out of Profit
          and loss without somebody being told. */}
      <Link
        to={jobViewLink('attention')}
        className={attention > 0 ? 'dash-tile dash-tile-link dash-tile-attention' : 'dash-tile dash-tile-link'}
      >
        <span className="dash-tile-label">Needs attention</span>
        <span className="dash-tile-value">{attention}</span>
        <span className="dash-tile-foot">
          {attention === 0
            ? 'Nothing missing on any open job'
            : `${attention === 1 ? 'Job is' : 'Jobs are'} missing a price, parts, pay or invoice, or a quote is going cold`}
        </span>
      </Link>

      <article className="dash-tile">
        <span className="dash-tile-label">Booked, next {bookingDays} days</span>
        <span className="dash-tile-value">{bookedSoon}</span>
        <span className="dash-tile-foot">
          {bookedSoon === 0
            ? 'Nothing on the calendar yet'
            : `${bookedSoon === 1 ? 'Install' : 'Installs'} scheduled`}
        </span>
      </article>

      <article className="dash-tile">
        <span className="dash-tile-label">Stock on hand</span>
        <span className="dash-tile-value">{formatCurrency(inventoryValue)}</span>
        <span className="dash-tile-foot">
          {itemCount === 0
            ? 'No catalog items yet'
            : `${inventoryUnits} ${inventoryUnits === 1 ? 'unit' : 'units'} across ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
          {unpricedItems > 0
            && `, ${unpricedItems} with no cost and left out of the value`}
        </span>
      </article>
    </StatGrid>
  )
}
