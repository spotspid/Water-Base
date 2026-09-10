import { Link } from 'react-router-dom'
import { installLabel, isOverdue, isUrgent, jobsWaiting, waitedLabel } from '../lib/paperwork'

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

  // Documents held back because the job is not ready to send them. Counted
  // rather than listed: the number is worth knowing, the rows are not, and
  // putting them back in the table is what made the old panel unreadable.
  const notReady = (rows.notReady || []).length

  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Out for signature</h2>
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

      {jobCount > 0 && rows.length === 0 && notReady === 0 && (
        <p className="dash-clear">
          Every open job has a signed customer agreement and a signed work order.
          Nothing is waiting on a signature.
        </p>
      )}

      {jobCount > 0 && rows.length === 0 && notReady > 0 && (
        <p className="dash-clear">
          Nobody is sitting on a signature. Every outstanding document belongs to a
          job that is not ready to send it yet.
        </p>
      )}

      {/* Only alongside a table. With no rows the empty state above already
          says this, and printing both would say it twice. */}
      {rows.length > 0 && notReady > 0 && (
        <p className="dash-not-ready">
          {notReady} more {notReady === 1 ? 'document is' : 'documents are'} waiting on the
          job rather than on a person, so {notReady === 1 ? 'it is' : 'they are'} not listed.
          {' '}
          <Link to="/documents" className="tpl-link">See what they need</Link>
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
                  <td className={dueClass(row)}>
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

// Overdue is maroon and soon is amber. They used to share the maroon, which
// flattened "in 2 days" and "1 day overdue" into the same alarm.
function dueClass(row) {
  if (isOverdue(row)) return 'col-nowrap dash-due'
  if (isUrgent(row)) return 'col-nowrap dash-due-soon'
  return 'col-nowrap'
}
