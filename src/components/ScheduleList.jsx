import { STATUS_LABELS } from '../lib/constants'
import { crewLabel, formatLongDate, sortForList } from '../lib/schedule'
import EmptyState from './EmptyState'

// The same week or month as the calendar, read top to bottom instead of laid
// out in a grid. This is the view for a phone, for printing, and for the
// morning where the question is what is next rather than what is Thursday.
export default function ScheduleList({ rows, onOpen }) {
  const ordered = sortForList(rows)

  if (ordered.length === 0) {
    return (
      <EmptyState title="Nothing in this range" tone="filtered" compact>
        <p>
          No job falls in the week or month you are looking at. Step to another range,
          or check Unscheduled on the calendar view for jobs with no date yet.
        </p>
      </EmptyState>
    )
  }

  const unassigned = ordered.filter(j => !crewLabel(j)).length

  return (
    <div className="table-wrap">
      <table className="jobs-table sch-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Window</th>
            <th>Customer</th>
            <th>Address</th>
            <th>Installer</th>
            <th>Helper</th>
            <th>System</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map(job => (
            <tr
              key={job.id}
              className="inv-row"
              tabIndex={0}
              onClick={() => onOpen(job.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(job.id)
                }
              }}
            >
              <td className="col-nowrap">
                {job.calendar_date
                  ? formatLongDate(job.calendar_date)
                  : <span className="sch-window-missing">Unscheduled</span>}
              </td>
              <td className="col-nowrap">
                {job.time_window || <span className="sch-window-missing">No window</span>}
              </td>
              <td className="td-customer">{job.customer_name}</td>
              <td>
                {job.address}
                {job.city && <span className="sch-card-city">{job.city}</span>}
              </td>
              <td>
                {job.installer_name || job.installer_text
                  || <span className="sch-crew-missing">Unassigned</span>}
              </td>
              <td>{job.helper_name || <span className="sch-list-dash">None</span>}</td>
              <td>{job.system_template}</td>
              <td>
                <span className={`status-badge status-${job.status}`}>
                  {STATUS_LABELS[job.status] || job.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="inv-ledger-note">
        Sorted by date, then by time window, then by customer. Jobs with no date yet sit at
        the top, because they are the ones still needing one.
        {unassigned === 0
          ? ' Every job here has a crew.'
          : ` ${unassigned} ${unassigned === 1 ? 'job has' : 'jobs have'} no crew assigned yet.`}
      </p>
    </div>
  )
}
