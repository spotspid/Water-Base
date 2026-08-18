import { Link } from 'react-router-dom'
import { formatCurrency } from '../lib/inventory'

export default function DashboardStatus({ statuses, totalJobs }) {
  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Jobs by Status</h2>
        <Link to="/jobs" className="tpl-link">All jobs</Link>
      </header>

      {totalJobs === 0 && (
        <p className="inv-state">No jobs yet, so every status sits at zero.</p>
      )}

      {totalJobs > 0 && (
        <ul className="dash-status-list">
          {statuses.map(row => (
            <li key={row.status} className="dash-status-row">
              <span className={`status-badge status-${row.status}`}>{row.label}</span>
              <span className="dash-bar" aria-hidden="true">
                <span className={`dash-bar-fill dash-bar-${row.status}`} style={{ width: `${row.share}%` }} />
              </span>
              <span className="dash-status-count">{row.count}</span>
              <span className="dash-status-revenue">{formatCurrency(row.revenue)}</span>
            </li>
          ))}
        </ul>
      )}

      {totalJobs > 0 && (
        <p className="dash-panel-foot">
          {totalJobs} {totalJobs === 1 ? 'job' : 'jobs'} all time. Revenue is the sale price
          booked at each status.
        </p>
      )}
    </section>
  )
}
