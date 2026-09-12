import { Link } from 'react-router-dom'
import { crewLabel, isMovable } from '../lib/schedule'
import { useJobReadiness } from '../lib/readinessContext'

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
      <p className="sch-card-name">
        {job.customer_name}
        <ReadinessBadge jobId={job.id} compact={compact} />
      </p>

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

/**
 * Whether the van can be loaded for this job.
 *
 * Sits on the name line rather than below the card, so scanning a day means
 * reading down one column of dots instead of hunting the bottom of each card.
 *
 * In a month cell there is no room for a word, so it is the dot alone and the
 * word moves into the title and the screen reader label. The dot is never the
 * only carrier of the meaning: colour says it fastest, the text says it at
 * all.
 *
 * Nothing renders when readiness is unknown. An absent badge means "not asked
 * or not answered", which is why silence has to look like silence rather than
 * like a pass.
 */
function ReadinessBadge({ jobId, compact }) {
  const readiness = useJobReadiness(jobId)

  if (!readiness) return null

  const className =
    `sch-ready sch-ready-${readiness.tone}${compact ? ' sch-ready-dot' : ''}`

  const body = (
    <>
      <span className="sch-ready-mark" aria-hidden="true" />
      <span className={compact ? 'sr-only' : 'sch-ready-text'}>{readiness.label}</span>
    </>
  )

  // Ready has nothing to fix, so it stays a label. Anything else links to the
  // job with the field named, and the drawer opens its edit form on that box.
  //
  // stopPropagation because the whole card is already a button that opens the
  // job. Without it the click would both follow the link and fire the card's
  // open, and the card would win the race.
  if (!readiness.fix) {
    return <span className={className} title={readiness.detail}>{body}</span>
  }

  return (
    <Link
      to={`/jobs?job=${encodeURIComponent(jobId)}&fix=${encodeURIComponent(readiness.fix)}`}
      className={`${className} sch-ready-link`}
      title={`${readiness.detail} Click to fix it.`}
      onClick={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
    >
      {body}
    </Link>
  )
}
