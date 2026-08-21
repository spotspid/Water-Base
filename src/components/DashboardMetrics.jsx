import { formatCurrency } from '../lib/inventory'

// Four figures, all summed from rows the page already loaded.
//
// Margin is the one that needs care. A job that has not been installed has
// committed its parts but drawn none, and carries no payout, so its margin
// equals the whole sale price. Presented plainly that reads as a 100 percent
// margin, which is not a result, it is an artefact of the work not having
// happened yet. Anything still pending is labelled projected and says how many
// jobs are waiting, so nobody reads a forecast as earned.
export default function DashboardMetrics({
  monthTotals, monthName, inventoryValue, inventoryUnits, itemCount,
}) {
  const { count, revenue, margin, avgMargin, installedCount, pendingCount, projected } = monthTotals
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : null

  const pendingNote = pendingCount === 1
    ? '1 job has not been installed, so its parts and pay are not recorded yet'
    : `${pendingCount} jobs have not been installed, so their parts and pay are not recorded yet`

  return (
    <div className="dash-metrics">
      <article className="dash-tile">
        <span className="dash-tile-label">Revenue in {monthName}</span>
        <span className="dash-tile-value">{formatCurrency(revenue)}</span>
        <span className="dash-tile-foot">
          {count === 0 ? 'No jobs written yet this month' : `${count} ${count === 1 ? 'job' : 'jobs'} booked`}
        </span>
      </article>

      <article className={margin < 0 ? 'dash-tile dash-tile-bad' : 'dash-tile'}>
        <span className="dash-tile-label">
          Margin in {monthName}
          {projected && count > 0 && <span className="dash-projected">projected</span>}
        </span>
        <span className="dash-tile-value">{formatCurrency(margin)}</span>
        <span className="dash-tile-foot">
          {count === 0
            ? 'No jobs to measure'
            : projected
              ? pendingNote
              : `${marginPct == null ? '' : `${marginPct.toFixed(1)}% of revenue, `}all ${count === 1 ? 'job' : 'jobs'} installed`}
        </span>
      </article>

      <article className="dash-tile">
        <span className="dash-tile-label">
          Margin per Job
          {projected && count > 0 && <span className="dash-projected">projected</span>}
        </span>
        <span className="dash-tile-value">
          {avgMargin == null ? 'n/a' : formatCurrency(avgMargin)}
        </span>
        <span className="dash-tile-foot">
          {avgMargin == null
            ? 'Needs at least one job this month'
            : `Across ${count} ${count === 1 ? 'job' : 'jobs'}, ${installedCount} installed`}
        </span>
      </article>

      <article className="dash-tile">
        <span className="dash-tile-label">Stock on Hand</span>
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
