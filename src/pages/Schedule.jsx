import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import {
  SCHEDULE_COLUMNS, addDays, addMonths, groupByDate, monthGrid,
  formatLongDate, startOfWeek, toISODate, weekDays,
} from '../lib/schedule'
import AppShell from '../components/AppShell'
import ScheduleCalendar from '../components/ScheduleCalendar'
import ScheduleJobModal from '../components/ScheduleJobModal'
import ScheduleList from '../components/ScheduleList'
import ScheduleToolbar from '../components/ScheduleToolbar'
import ScheduleUnscheduled from '../components/ScheduleUnscheduled'
import './Schedule.css'

// The range the current view covers. Month uses the whole six row grid rather
// than the calendar month, so the leading and trailing days that are visible
// are also loaded and a job on the 31st of the previous month is not a blank
// cell that quietly hides work.
function rangeFor(mode, anchor) {
  const days = mode === 'month' ? monthGrid(anchor) : weekDays(anchor)
  return { from: toISODate(days[0]), to: toISODate(days[days.length - 1]) }
}

export default function Schedule() {
  const [view, setView] = useState('calendar')
  const [mode, setMode] = useState('week')
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()))

  const [rows, setRows] = useState([])
  const [unscheduled, setUnscheduled] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [openJobId, setOpenJobId] = useState('')
  const [dragJobId, setDragJobId] = useState('')
  const [movingId, setMovingId] = useState('')
  const [moveError, setMoveError] = useState('')
  const [moveNotice, setMoveNotice] = useState('')

  const range = useMemo(() => rangeFor(mode, anchor), [mode, anchor])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [dated, undated] = await Promise.all([
      attempt(
        () => supabase
          .from('job_schedule')
          .select(SCHEDULE_COLUMNS)
          .gte('calendar_date', range.from)
          .lte('calendar_date', range.to)
          .order('calendar_date', { ascending: true }),
        'The schedule could not be loaded.',
      ),
      attempt(
        () => supabase
          .from('job_schedule')
          .select(SCHEDULE_COLUMNS)
          .is('calendar_date', null)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: true }),
        'Unscheduled jobs could not be loaded.',
      ),
    ])

    const firstError = dated.error || undated.error

    if (firstError) {
      setError(firstError)
      setRows([])
      setUnscheduled([])
    } else {
      setRows(dated.data || [])
      setUnscheduled(undated.data || [])
    }

    setLoading(false)
  }, [range.from, range.to])

  useEffect(() => { load() }, [load])

  const byDate = useMemo(() => groupByDate(rows), [rows])

  const openJob = useMemo(
    () => [...rows, ...unscheduled].find(j => j.id === openJobId) || null,
    [rows, unscheduled, openJobId],
  )

  function step(direction) {
    setAnchor(current => (mode === 'month'
      ? addMonths(current, direction)
      : addDays(current, direction * 7)))
  }

  function goToday() {
    setAnchor(mode === 'month' ? new Date() : startOfWeek(new Date()))
  }

  function switchMode(next) {
    setMode(next)
    setAnchor(current => (next === 'week' ? startOfWeek(current) : current))
  }

  function handleDragStart(e, job) {
    setDragJobId(job.id)
    setMoveError('')
    setMoveNotice('')
    try {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', job.id)
      e.dataTransfer.setData('application/x-water-base-job', job.id)
    } catch {
      // a browser that refuses setData still leaves the id in state above,
      // which is what the drop handler reads first
    }
  }

  function handleDragEnd() {
    setDragJobId('')
  }

  // A drag moves the date only. Who is on the job is deliberately left alone,
  // because moving Thursday to Friday is not a statement about the crew.
  async function handleMove(jobId, dateKey) {
    const job = [...rows, ...unscheduled].find(j => j.id === jobId)

    setMovingId(jobId)
    setMoveError('')
    setMoveNotice('')

    const { data, error: err } = await attempt(
      () => supabase.rpc('schedule_job', {
        p_job_id: jobId,
        p_scheduled_date: dateKey,
        p_time_window: job?.time_window || null,
        p_installer_id: null,
        p_helper_id: null,
        p_set_crew: false,
      }),
      'That job could not be moved.',
    )

    setMovingId('')

    if (err) {
      setMoveError(err)
      await load()
      return
    }

    const who = job?.customer_name || 'The job'
    const count = Number(data?.conflict_count) || 0
    setMoveNotice(count === 0
      ? `${who} moved to ${formatLongDate(dateKey)}.`
      : `${who} moved to ${formatLongDate(dateKey)}, but ${count} ${count === 1 ? 'part is' : 'parts are'} already promised elsewhere. Open the job to see which.`)

    await load()
  }

  const hasData = !loading && !error

  return (
    <AppShell>
      <div className="sch-page">
        <div className="jobs-header">
          <h1>Schedule</h1>
        </div>

        <ScheduleToolbar
          view={view} onView={setView}
          mode={mode} onMode={switchMode}
          anchor={anchor} onStep={step} onToday={goToday}
          busy={loading}
        />

        {moveError && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">That job could not be moved.</p>
            <p className="inv-error-detail">{moveError}</p>
            <button type="button" className="btn-cancel" onClick={() => setMoveError('')}>
              Dismiss
            </button>
          </div>
        )}

        {moveNotice && <p className="job-notice" role="status">{moveNotice}</p>}

        {loading && <p className="inv-state">Loading the schedule...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">The schedule could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              This page reads the <code>job_schedule</code> view. If it does not exist yet,
              apply <code>supabase/migrations/20260822_create_scheduling.sql</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && (
          <div className={view === 'calendar' ? 'sch-layout' : 'sch-layout sch-layout-list'}>
            <div className="sch-main">
              {view === 'calendar' ? (
                <ScheduleCalendar
                  mode={mode}
                  anchor={anchor}
                  byDate={byDate}
                  onOpen={setOpenJobId}
                  onMove={handleMove}
                  movingId={movingId}
                  dragJobId={dragJobId}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
              ) : (
                <ScheduleList rows={[...unscheduled, ...rows]} onOpen={setOpenJobId} />
              )}
            </div>

            {view === 'calendar' && (
              <ScheduleUnscheduled
                jobs={unscheduled}
                onOpen={setOpenJobId}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                dragJobId={dragJobId}
              />
            )}
          </div>
        )}

        {hasData && view === 'calendar' && (
          <p className="inv-ledger-note">
            Each card shows the customer, the address, the time window, the crew and the
            system. Drag a card to another day to reschedule it, which moves the date and
            leaves the crew as it is. Installed and cancelled jobs stay where they are,
            because their date is a record of what happened rather than a plan.
          </p>
        )}
      </div>

      {openJob && (
        <ScheduleJobModal
          job={openJob}
          onClose={() => setOpenJobId('')}
          onSaved={load}
        />
      )}
    </AppShell>
  )
}
