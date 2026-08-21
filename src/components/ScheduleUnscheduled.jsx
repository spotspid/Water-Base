import ScheduleJobCard from './ScheduleJobCard'

// Sold jobs with no date yet. They sit beside the calendar so a week can be
// filled by dragging from here onto a day, which is the actual motion of
// planning a week rather than opening each job in turn.
export default function ScheduleUnscheduled({ jobs, onOpen, onDragStart, onDragEnd, dragJobId }) {
  return (
    <aside className="sch-unscheduled">
      <header className="sch-unscheduled-head">
        <h2>Unscheduled</h2>
        <span className="set-count">{jobs.length}</span>
      </header>

      {jobs.length === 0 ? (
        <p className="sch-unscheduled-empty">
          Every sold job has a date. Nothing is waiting to be booked.
        </p>
      ) : (
        <>
          <p className="sch-unscheduled-hint">
            Drag one onto a day, or click to pick a date and crew.
          </p>
          <div className="sch-unscheduled-list">
            {jobs.map(job => (
              <ScheduleJobCard
                key={job.id}
                job={job}
                compact
                dragging={dragJobId === job.id}
                onOpen={onOpen}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
