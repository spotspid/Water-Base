import { Link } from 'react-router-dom'
import { installLabel, isUrgent, jobsWaiting, waitedLabel } from '../lib/paperwork'

// What is stopping jobs from happening.
//
// This has the space the stock table used to have, and it earns it: a job far
// more often stalls on a signature than on a shelf. The customer agreement is
// what makes the sale real and the work order is what makes the installer
// real, and either one unsent or unsigned holds everything behind it.
//
// One row per document, not per job. A job can be waiting on both and they are
// chased in different directions, so folding them together would hide half the
// work behind one line.
export default function DashboardPaperwork({ rows, jobCount }) {
  const waiting = jobsWaiting(rows)

  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Waiting on paperwork</h2>
        <span className="dash-panel-note">
          {rows.length > 0
            ? `${rows.length} document${rows.length === 1 ? '' : 's'} across `
              + `${waiting} job${waiting === 1 ? '' : 's'}`
            : 'Sent and unsigned, or never sent'}
        </span>
        <Link to="/jobs" className="tpl-link">Jobs</Link>
      </header>

      {jobCount === 0 && (
        <p className="inv-state">No open jobs, so there is no paperwork to chase.</p>
      )}

      {jobCount > 0 && rows.length === 0 && (
        <p className="dash-clear">
          Every open job has a signed customer agreement and a signed work order.
          Nothing is waiting on a signature.
        </p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Document</th>
                <th>State</th>
                <th className="col-num">Waiting</th>
                <th>Install</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={`${row.job_id}-${row.type}`}>
                  <td className="td-customer">
                    {row.customer_name}
                    {row.installer_name && (
                      <span className="cell-sub">{row.installer_name}</span>
                    )}
                  </td>
                  <td className="col-nowrap">{row.document}</td>
                  <td>
                    {/* Written out whole rather than assembled from a prefix
                        and a fragment, so the class can be found by searching
                        for it. */}
                    <span className={row.tone === 'bad' ? 'pill pill-red' : 'pill pill-amber'}>
                      {row.label}
                    </span>
                  </td>
                  <td className="col-num">
                    {waitedLabel(row) || <span className="cell-unset">unknown</span>}
                    {row.waitedFrom && waitedLabel(row) && (
                      <span className="cell-sub">since {row.waitedFrom}</span>
                    )}
                  </td>
                  <td className={isUrgent(row) ? 'col-nowrap dash-due' : 'col-nowrap'}>
                    {installLabel(row)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
