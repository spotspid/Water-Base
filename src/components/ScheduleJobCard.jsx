import { crewLabel, isMovable } from '../lib/schedule'

// One job as it appears in a calendar cell. This is the thing David reads off
// the screen, so the four facts he needs are always present and always in the
// same order: who, where, when, and who is going. System type follows, since
// it is what tells him what is going on the truck.
//
// A job that cannot be moved is not draggable and says so on hover, rather
// than accepting the drag and failing at the database.
export default function ScheduleJobCard({ job, onOpen, onDragStart, onDragEnd, dragging, compact }) {
  const movable = isMovable(job)
  const crew = crewLabel(job)
  const accent = job.installer_color || 'var(--gray-300)'

  const classes = [
    'sch-card',
    `sch-card-${job.status}`,
    compact ? 'sch-card-compact' : '',
    dragging ? 'sch-card-dragging' : '',
    movable ? '' : 'sch-card-fixed',
  ].filter(Boolean).join(' ')

  const title = movable
    ? `${job.customer_name}. Drag to another day, or click to open.`
    : `${job.customer_name}. This job is ${job.status}, so its date cannot be dragged.`

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(job.id)
    }
  }

  return (
    <article
      className={classes}
      style={{ borderLeftColor: accent }}
      draggable={movable}
      onDragStart={movable ? e => onDragStart(e, job) : undefined}
      onDragEnd={movable ? onDragEnd : undefined}
      onClick={() => onOpen(job.id)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      title={title}
    >
      <p className="sch-card-name">{job.customer_name}</p>

      <p className="sch-card-address">
        {job.address}
        {job.city && <span className="sch-card-city">{job.city}</span>}
      </p>

      <p className="sch-card-meta">
        <span className={job.time_window ? 'sch-window' : 'sch-window sch-window-missing'}>
          {job.time_window || 'No window'}
        </span>
        <span className={crew ? 'sch-crew' : 'sch-crew sch-crew-missing'}>
          {crew || 'Unassigned'}
        </span>
      </p>

      <p className="sch-card-system">{job.system_template}</p>
    </article>
  )
}
