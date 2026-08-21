import { useState } from 'react'
import {
  WEEKDAY_LABELS, formatDayNumber, isToday, monthGrid, toISODate, weekDays,
} from '../lib/schedule'
import ScheduleJobCard from './ScheduleJobCard'

// Week and month share one grid. A week is one row of seven tall cells, a
// month is six rows of seven short ones, so the only real difference is how
// many days are laid out and how much of each job is shown.
//
// Reschedule is native HTML5 drag and drop rather than a library. The whole
// interaction is pick up a card, drop it on a day, which is what the browser
// already does, and a dependency for it would be bundle size spent on a drop
// handler we would still have to write.
//
// Which job is in flight is the page's state, not this component's, because a
// drag can start in the unscheduled panel next door and end in a cell here.
// Only the hover highlight is local, since that is genuinely per cell.
export default function ScheduleCalendar({
  mode, anchor, byDate, onOpen, onMove, movingId, dragJobId, onDragStart, onDragEnd,
}) {
  const [overKey, setOverKey] = useState('')

  const days = mode === 'month' ? monthGrid(anchor) : weekDays(anchor)
  const anchorMonth = anchor.getMonth()

  function handleDragOver(e, key) {
    if (!dragJobId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overKey !== key) setOverKey(key)
  }

  function handleDragLeave(key) {
    setOverKey(current => (current === key ? '' : current))
  }

  function handleDrop(e, key) {
    e.preventDefault()

    let jobId = dragJobId
    if (!jobId) {
      try {
        jobId = e.dataTransfer.getData('application/x-water-base-job')
          || e.dataTransfer.getData('text/plain')
      } catch {
        jobId = ''
      }
    }

    setOverKey('')
    onDragEnd()

    if (!jobId) return

    // dropping a job back on the day it already occupies is a no op rather
    // than a write, so a nudge that lands where it started costs nothing
    const alreadyHere = (byDate.get(key) || []).some(j => j.id === jobId)
    if (alreadyHere) return

    onMove(jobId, key)
  }

  return (
    <div className={mode === 'month' ? 'sch-grid sch-grid-month' : 'sch-grid sch-grid-week'}>
      {WEEKDAY_LABELS.map(label => (
        <div key={label} className="sch-weekday" aria-hidden="true">{label}</div>
      ))}

      {days.map(day => {
        const key = toISODate(day)
        const jobs = byDate.get(key) || []
        const outside = mode === 'month' && day.getMonth() !== anchorMonth
        const classes = [
          'sch-cell',
          outside ? 'sch-cell-outside' : '',
          isToday(day) ? 'sch-cell-today' : '',
          overKey === key ? 'sch-cell-over' : '',
        ].filter(Boolean).join(' ')

        return (
          <section
            key={key}
            className={classes}
            onDragOver={e => handleDragOver(e, key)}
            onDragLeave={() => handleDragLeave(key)}
            onDrop={e => handleDrop(e, key)}
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
              {jobs.map(job => (
                <ScheduleJobCard
                  key={job.id}
                  job={job}
                  compact={mode === 'month'}
                  dragging={dragJobId === job.id || movingId === job.id}
                  onOpen={onOpen}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
