import { Link } from 'react-router-dom'
import ScheduleJobCard from './ScheduleJobCard'

// Sold jobs with no date yet. They sit beside the calendar so a week can be
// filled by dragging from here onto a day, which is the actual motion of
// planning a week rather than opening each job in turn.
export default function ScheduleUnscheduled({
  jobs, onOpen, onPointerDown, drag, hasAnyJobs,
}) {
  return (
    <aside className="sch-unscheduled">
      <header className="sch-unscheduled-head">
        <h2>Unscheduled</h2>
        <span className="set-count">{jobs.length}</span>
      </header>

      {jobs.length === 0 ? (
        <p className="sch-unscheduled-empty">
          {hasAnyJobs
            ? 'Every open job has a date. Nothing is waiting to be booked.'
            : (
              <>
                Jobs land here when they are sold without a date.
                {' '}<Link to="/jobs/new" className="tpl-link">Write one up</Link>.
              </>
            )}
        </p>
      ) : (
        <>
          <p className="sch-unscheduled-hint">
            Hold and drag one onto a day, or tap to pick a date and crew.
          </p>
          <div className="sch-unscheduled-list">
            {jobs.map(job => (
              <ScheduleJobCard
                key={job.id}
                job={job}
                compact
                dragging={drag?.jobId === job.id}
                onOpen={onOpen}
                onPointerDown={onPointerDown}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
