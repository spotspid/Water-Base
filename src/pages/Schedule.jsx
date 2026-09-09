import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import {
  SCHEDULE_COLUMNS, addDays, addMonths, groupByDate, monthGrid,
  formatLongDate, isMovable, startOfWeek, toISODate, weekDays,
} from '../lib/schedule'
import { useCalendarDrag } from '../lib/useCalendarDrag'
import { ReadinessProvider } from '../lib/ReadinessProvider'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import ReadinessNotice from '../components/ReadinessNotice'
import ScheduleCalendar from '../components/ScheduleCalendar'
import ScheduleDayModal from '../components/ScheduleDayModal'
import ScheduleJobCard from '../components/ScheduleJobCard'
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
  const [openDayKey, setOpenDayKey] = useState('')
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

  const allJobs = useMemo(() => [...rows, ...unscheduled], [rows, unscheduled])

  const openJob = useMemo(
    () => allJobs.find(j => j.id === openJobId) || null,
    [allJobs, openJobId],
  )

  // A drag moves the date only. Who is on the job is deliberately left alone,
  // because moving Thursday to Friday is not a statement about the crew.
  const handleDrop = useCallback(async (job, dateKey) => {
    if (String(job.calendar_date || '').slice(0, 10) === dateKey) return

    setMovingId(job.id)
    setMoveError('')
    setMoveNotice('')

    const { data, error: err } = await attempt(
      () => supabase.rpc('schedule_job', {
        p_job_id: job.id,
        p_scheduled_date: dateKey,
        p_time_window: job.time_window || null,
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

    const count = Number(data?.conflict_count) || 0
    setMoveNotice(count === 0
      ? `${job.customer_name} moved to ${formatLongDate(dateKey)}.`
      : `${job.customer_name} moved to ${formatLongDate(dateKey)}, but ${count} ${count === 1 ? 'part is' : 'parts are'} already short. Open the job to see which.`)

    await load()
  }, [load])

  const { drag, onPointerDown, swallowedClick } = useCalendarDrag({
    onDrop: handleDrop,
    canDrag: isMovable,
  })

  const handleOpen = useCallback(id => {
    if (swallowedClick()) return
    setOpenJobId(id)
  }, [swallowedClick])

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

  const hasData = !loading && !error
  const nothingAnywhere = hasData && allJobs.length === 0

  // Readiness is asked for every job on screen at once, scheduled or not. The
  // unscheduled rail needs it as much as the calendar does: knowing a job is
  // short before booking it is the point.
  const jobIds = useMemo(() => allJobs.map(j => j.id), [allJobs])

  return (
    <ReadinessProvider jobIds={jobIds}>
    <AppShell>
      <div className={drag ? 'sch-page sch-page-dragging' : 'sch-page'}>
        <div className="jobs-header">
          <h1>Schedule</h1>
          <Link to="/jobs/new" className="btn-primary">+ New job</Link>
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

        <ReadinessNotice />

        {loading && <p className="inv-state">Loading the schedule...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">The schedule could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              This page reads the <code>job_schedule</code> view. If it does not exist yet,
              apply <code>supabase/migrations/20260822000000_create_scheduling.sql</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {nothingAnywhere && (
          <EmptyState
            title="No jobs to schedule yet"
            actions={<Link to="/jobs/new" className="btn-primary">Write up a job</Link>}
          >
            <p>
              The calendar fills in from the jobs list. A job sold without a date waits in
              Unscheduled beside the calendar, and a job with a date shows on the day it is
              promised.
            </p>
          </EmptyState>
        )}

        {hasData && !nothingAnywhere && (
          <div className={view === 'calendar' ? 'sch-layout' : 'sch-layout sch-layout-list'}>
            <div className="sch-main">
              {view === 'calendar' ? (
                <ScheduleCalendar
                  mode={mode}
                  anchor={anchor}
                  byDate={byDate}
                  onOpen={handleOpen}
                  onOpenDay={setOpenDayKey}
                  movingId={movingId}
                  drag={drag}
                  onPointerDown={onPointerDown}
                />
              ) : (
                <ScheduleList rows={[...unscheduled, ...rows]} onOpen={handleOpen} />
              )}
            </div>

            {view === 'calendar' && (
              <ScheduleUnscheduled
                jobs={unscheduled}
                onOpen={handleOpen}
                onPointerDown={onPointerDown}
                drag={drag}
                hasAnyJobs={allJobs.length > 0}
              />
            )}
          </div>
        )}

        {hasData && !nothingAnywhere && view === 'calendar' && (
          <p className="inv-ledger-note">
            Each card shows the customer, the address, the time window, the crew and the
            system. Hold a card and drag it to another day to reschedule, which moves the
            date and leaves the crew as it is. Installed and cancelled jobs stay where they
            are, because their date is a record of what happened rather than a plan.
          </p>
        )}
      </div>

      {/* follows the pointer during a drag, and is inert to hit testing */}
      {drag && (
        <div
          className="sch-drag-preview"
          style={{ transform: `translate3d(${drag.x}px, ${drag.y}px, 0)` }}
        >
          <ScheduleJobCard job={drag.job} preview onOpen={() => {}} onPointerDown={() => {}} />
        </div>
      )}

      {openDayKey && (
        <ScheduleDayModal
          dateKey={openDayKey}
          jobs={byDate.get(openDayKey) || []}
          onOpen={setOpenJobId}
          onClose={() => setOpenDayKey('')}
        />
      )}

      {openJob && (
        <ScheduleJobModal
          job={openJob}
          onClose={() => setOpenJobId('')}
          onSaved={load}
        />
      )}
    </AppShell>
    </ReadinessProvider>
  )
}
