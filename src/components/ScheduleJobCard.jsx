import { crewLabel, isMovable } from '../lib/schedule'

// One job as it appears in a calendar cell. This is the thing David reads off
// the screen, so the four facts he needs are always present and always in the
// same order: who, where, when, and who is going. System type follows, since
// it is what tells him what is going on the truck.
//
// Dragging is driven by pointer events from the page, not by the draggable
// attribute, so the same press works with a mouse and with a finger.
export default function ScheduleJobCard({
  job, onOpen, onPointerDown, dragging, compact, preview,
}) {
  const movable = isMovable(job)
  const crew = crewLabel(job)
  const accent = job.installer_color || 'var(--gray-300)'

  const classes = [
    'sch-card',
    `sch-card-${job.status}`,
    compact ? 'sch-card-compact' : '',
    dragging ? 'sch-card-dragging' : '',
    preview ? 'sch-card-preview' : '',
    movable ? 'sch-card-movable' : 'sch-card-fixed',
  ].filter(Boolean).join(' ')

  const title = movable
    ? `${job.customer_name}. Hold and drag to another day, or tap to open.`
    : `${job.customer_name}. This job is ${job.status}, so its date cannot be moved.`

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(job.id)
    }
  }

  // The floating copy that follows the pointer is decoration. It must not be
  // focusable, clickable, or visible to a screen reader, and above all it
  // must not intercept the hit test that finds the day underneath it.
  if (preview) {
    return (
      <article className={classes} style={{ borderLeftColor: accent }} aria-hidden="true">
        <CardBody job={job} crew={crew} compact={false} />
      </article>
    )
  }

  return (
    <article
      className={classes}
      style={{ borderLeftColor: accent }}
      data-job-id={job.id}
      onPointerDown={movable ? e => onPointerDown(e, job) : undefined}
      onClick={() => onOpen(job.id)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      title={title}
    >
      <CardBody job={job} crew={crew} compact={compact} />
    </article>
  )
}

function CardBody({ job, crew, compact }) {
  return (
    <>
      <p className="sch-card-name">{job.customer_name}</p>

      {!compact && (
        <p className="sch-card-address">
          {job.address}
          {job.city && <span className="sch-card-city">{job.city}</span>}
        </p>
      )}

      <p className="sch-card-meta">
        <span className={job.time_window ? 'sch-window' : 'sch-window sch-window-missing'}>
          {job.time_window || 'No window'}
        </span>
        <span className={crew ? 'sch-crew' : 'sch-crew sch-crew-missing'}>
          {crew || 'Unassigned'}
        </span>
      </p>

      {!compact && <p className="sch-card-system">{job.system_template}</p>}
    </>
  )
}
