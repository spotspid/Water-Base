import { Link } from 'react-router-dom'
import { formatCurrency } from '../lib/inventory'

// Only statuses that actually hold a job get a row. An empty bar next to
// $0.00 is three lines of furniture saying nothing, and with four statuses and
// one in use it was most of the panel. The ones sitting at zero are named in a
// single quiet line underneath instead, so the shape of the pipeline is still
// readable without the noise.
export default function DashboardStatus({ statuses, totalJobs }) {
  const used = statuses.filter(row => row.count > 0)
  const empty = statuses.filter(row => row.count === 0)

  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Jobs by status</h2>
        <Link to="/jobs" className="tpl-link">All jobs</Link>
      </header>

      {totalJobs === 0 && (
        <p className="inv-state">No jobs yet, so every status sits at zero.</p>
      )}

      {totalJobs > 0 && (
        <ul className="dash-status-list">
          {used.map(row => (
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
          {totalJobs} {totalJobs === 1 ? 'job' : 'jobs'} all time.
          {empty.length > 0 && (
            <> Nothing is {empty.map(r => r.label.toLowerCase()).join(' or ')} yet.</>
          )}
        </p>
      )}
    </section>
  )
}
