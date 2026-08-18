import { formatCurrency } from '../lib/inventory'

// Six figures, all summed from rows the page already loaded. A zero here is a
// real zero rather than a placeholder, which is why the month tiles still
// render when no job has been written yet this month.
export default function DashboardMetrics({
  monthTotals, monthName, inventoryValue, inventoryUnits, itemCount,
}) {
  const { count, revenue, margin, avgMargin } = monthTotals
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : null

  return (
    <div className="dash-metrics">
      <article className="dash-tile dash-tile-lead">
        <span className="dash-tile-label">Revenue in {monthName}</span>
        <span className="dash-tile-value">{formatCurrency(revenue)}</span>
        <span className="dash-tile-foot">
          {count === 0 ? 'No jobs written yet this month' : `${count} ${count === 1 ? 'job' : 'jobs'}`}
        </span>
      </article>

      <article className={margin < 0 ? 'dash-tile dash-tile-bad' : 'dash-tile'}>
        <span className="dash-tile-label">Margin in {monthName}</span>
        <span className="dash-tile-value">{formatCurrency(margin)}</span>
        <span className="dash-tile-foot">
          {marginPct == null ? 'No revenue to measure against' : `${marginPct.toFixed(1)}% of revenue`}
        </span>
      </article>

      <article className="dash-tile">
        <span className="dash-tile-label">Average Margin per Job</span>
        <span className="dash-tile-value">
          {avgMargin == null ? 'n/a' : formatCurrency(avgMargin)}
        </span>
        <span className="dash-tile-foot">
          {avgMargin == null ? 'Needs at least one job this month' : `Across ${count} ${count === 1 ? 'job' : 'jobs'}`}
        </span>
      </article>

      <article className="dash-tile">
        <span className="dash-tile-label">Inventory Value On Hand</span>
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
