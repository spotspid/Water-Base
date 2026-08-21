import { formatCurrency } from '../lib/inventory'

// Four figures that answer "what needs doing", not "how did we do".
//
// Margin used to sit here twice and is gone. With one install ever, and that
// one predating the app, no job has drawn parts or recorded a payout, so
// margin equalled revenue on every row and the percentage was always 100.
// A number that cannot currently be wrong is not telling anyone anything.
// Margin lives on Profit and loss, where the month range makes it meaningful.
export default function DashboardMetrics({
  monthTotals, monthName, notBooked, bookedSoon, bookingDays,
  inventoryValue, inventoryUnits, itemCount,
}) {
  const { count } = monthTotals

  return (
    <div className="dash-metrics">
      <article className="dash-tile">
        <span className="dash-tile-label">Revenue in {monthName}</span>
        <span className="dash-tile-value">{formatCurrency(monthTotals.revenue)}</span>
        <span className="dash-tile-foot">
          {count === 0 ? 'No jobs written yet this month' : `${count} ${count === 1 ? 'job' : 'jobs'} booked`}
        </span>
      </article>

      <article className={notBooked > 0 ? 'dash-tile dash-tile-attention' : 'dash-tile'}>
        <span className="dash-tile-label">Sold, not booked</span>
        <span className="dash-tile-value">{notBooked}</span>
        <span className="dash-tile-foot">
          {notBooked === 0
            ? 'Every sold job has a date'
            : `${notBooked === 1 ? 'Job is' : 'Jobs are'} waiting on a date`}
        </span>
      </article>

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
        </span>
      </article>
    </div>
  )
}
