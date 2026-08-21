import { formatLongDate, parseISODate } from '../lib/schedule'
import ScheduleJobCard from './ScheduleJobCard'
import Modal from './Modal'

// Every job on one day, for when a month cell has more than it can show.
//
// The alternative was scrolling inside the cell, which on a touch screen
// fights the drag gesture for the same finger movement. A day that is too
// full to render opens rather than scrolls.
export default function ScheduleDayModal({ dateKey, jobs, onOpen, onClose }) {
  const date = parseISODate(dateKey)
  const label = date ? formatLongDate(date) : 'That day'

  return (
    <Modal
      title={label}
      subtitle={`${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} scheduled`}
      onClose={onClose}
    >
      <div className="sch-day-list">
        {jobs.map(job => (
          <ScheduleJobCard
            key={job.id}
            job={job}
            onOpen={id => { onClose(); onOpen(id) }}
            onPointerDown={() => {}}
          />
        ))}
      </div>

      <p className="inv-ledger-note">
        Open a job to change its date, window or crew. Dragging works on the calendar
        itself, where there is somewhere to drop.
      </p>
    </Modal>
  )
}
