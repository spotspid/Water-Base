import {
  WEEKDAY_LABELS, formatDayNumber, isToday, monthGrid, toISODate, weekDays,
} from '../lib/schedule'
import ScheduleJobCard from './ScheduleJobCard'

// Week and month share one grid. A week is one row of seven tall cells, a
// month is six rows of seven short ones, so the only real difference is how
// many days are laid out and how much of each job is shown.
//
// A cell shows what it can fit and then says how many more there are. It does
// not scroll: a scrollable box inside a calendar cell competes with the drag
// gesture for the same finger, and on a phone the scroll always wins.
const VISIBLE_PER_CELL = { week: 6, month: 3 }

export default function ScheduleCalendar({
  mode, anchor, byDate, onOpen, onOpenDay, movingId, drag, onPointerDown,
}) {
  const days = mode === 'month' ? monthGrid(anchor) : weekDays(anchor)
  const anchorMonth = anchor.getMonth()
  const limit = VISIBLE_PER_CELL[mode] || VISIBLE_PER_CELL.month

  return (
    <div className={mode === 'month' ? 'sch-grid sch-grid-month' : 'sch-grid sch-grid-week'}>
      {WEEKDAY_LABELS.map(label => (
        <div key={label} className="sch-weekday" aria-hidden="true">{label}</div>
      ))}

      {days.map(day => {
        const key = toISODate(day)
        const jobs = byDate.get(key) || []
        const shown = jobs.slice(0, limit)
        const hidden = jobs.length - shown.length
        const outside = mode === 'month' && day.getMonth() !== anchorMonth

        const classes = [
          'sch-cell',
          outside ? 'sch-cell-outside' : '',
          isToday(day) ? 'sch-cell-today' : '',
          drag?.overKey === key ? 'sch-cell-over' : '',
          drag ? 'sch-cell-armed' : '',
        ].filter(Boolean).join(' ')

        return (
          <section
            key={key}
            className={classes}
            data-drop-date={key}
            aria-label={day.toLocaleDateString('en-US', {
              weekday: 'long', month: 'long', day: 'numeric',
            })}
          >
            <header className="sch-cell-head">
              <span className="sch-cell-day">{formatDayNumber(day)}</span>
              {jobs.length > 0 && (
                <span className="sch-cell-count">
                  {jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}
                </span>
              )}
            </header>

            <div className="sch-cell-body">
              {shown.map(job => (
                <ScheduleJobCard
                  key={job.id}
                  job={job}
                  compact={mode === 'month'}
                  dragging={drag?.jobId === job.id || movingId === job.id}
                  onOpen={onOpen}
                  onPointerDown={onPointerDown}
                />
              ))}

              {hidden > 0 && (
                <button
                  type="button"
                  className="sch-more"
                  onClick={() => onOpenDay(key)}
                >
                  {hidden} more
                </button>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
