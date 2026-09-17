import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { QUOTED_STATUS, STATUS_LABELS } from '../lib/constants'
import { billableJobs, realJobs } from '../lib/dashboard'
import { GROSS, profitTotals } from '../lib/profit'
import { searchJobs } from '../lib/search'
import { JOB_MARGIN_COLUMNS } from '../lib/jobColumns'
import { DEFAULT_SORT, sortJobs, sortStateFor } from '../lib/jobSort'
import { attempt } from '../lib/errors'
import { jobViewOf } from '../lib/jobViews'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import JobDetailModal from '../components/JobDetailModal'
import JobsSummary from '../components/JobsSummary'
import JobsTable from '../components/JobsTable'
import JobsToolbar from '../components/JobsToolbar'
import JobsViewBanner from '../components/JobsViewBanner'
import './Jobs.css'

const ALL_STATUSES = 'all'


export default function Jobs() {
  // Every Slack message links to /jobs?job=<id>, because a webhook cannot
  // thread and a line that says "unsigned for 9 days" is only useful if one
  // click lands on the job it is about. The id lives in the query string
  // rather than in state alone, so the link survives a refresh and can be
  // pasted to someone else.
  const [params, setParams] = useSearchParams()
  const openJobId = params.get('job') || ''

  // An alert that names a field can send you straight to it. The schedule's
  // readiness badge and the dashboard's blocker cards both link with ?fix=,
  // and the drawer opens its edit form on that box rather than leaving the
  // reader to find it. Unknown or absent is simply no focus, never an error.
  const fixField = params.get('fix') || ''

  // A named list from a dashboard tile, run with the tile's own counting rule.
  const viewKey = params.get('view') || ''
  const view = jobViewOf(viewKey)

  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(ALL_STATUSES)
  const [query, setQuery] = useState('')
  // Newest key date first, which is what the list has always opened on.
  const [sort, setSort] = useState(DEFAULT_SORT)
  // Test jobs are hidden unless asked for, so the attention list counts what
  // the dashboard tile counts.
  const [showTest, setShowTest] = useState(false)

  const openJobById = useCallback(id => {
    setParams(current => {
      const next = new URLSearchParams(current)
      if (id) next.set('job', id)
      else next.delete('job')
      // the field to fix belongs to the job that was opened with it, so it
      // never outlives the drawer that consumed it
      if (!id) next.delete('fix')
      return next
    }, { replace: true })
  }, [setParams])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => supabase
        .from('job_margin')
        .select(JOB_MARGIN_COLUMNS)
        .order('created_at', { ascending: false }),
      'Jobs could not be loaded.',
    )

    if (err) {
      setError(err)
      setJobs([])
    } else {
      setJobs(data || [])
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // A quote is not a job here. It is a price nobody has agreed to, it holds no
  // parts and it is in none of the money on this page, so it is listed on
  // /quotes instead of sitting in this table under a status filter.
  const sold = useMemo(() => jobs.filter(j => j.status !== QUOTED_STATUS), [jobs])

  const testCount = useMemo(() => sold.length - realJobs(sold).length, [sold])
  const shown = useMemo(() => (showTest ? sold : realJobs(sold)), [sold, showTest])
  const inView = useMemo(() => (view ? view.filter(shown) : shown), [shown, view])

  const clearView = useCallback(() => {
    setParams(current => {
      const next = new URLSearchParams(current)
      next.delete('view')
      return next
    }, { replace: true })
  }, [setParams])

  // Sorted by whichever column the person pressed, and by the date the Key
  // date column shows until they press one. That default runs the same
  // jobListDate the column reads, so the order and the column cannot disagree.
  const visible = useMemo(
    () => sortJobs(searchJobs(
      status === ALL_STATUSES ? inView : inView.filter(j => j.status === status),
      query,
    ), sort),
    [inView, status, query, sort],
  )

  // Cancelled jobs stay in the list and in the status filter, but never in
  // the money. A cancelled sale that still counted as revenue would overstate
  // every total on this bar.
  const counted = useMemo(() => billableJobs(visible), [visible])

  const cancelledCount = visible.length - counted.length

  // Split by what each figure rests on rather than summed into one number.
  // Adding a settled figure to an estimate makes a third thing that is neither,
  // and a job with nothing costed contributes nothing rather than its whole
  // price. That last part is what used to make this bar read 30,080.
  const totals = useMemo(() => profitTotals(counted), [counted])

  const openJob = useMemo(
    () => jobs.find(j => j.id === openJobId) || null,
    [jobs, openJobId],
  )

  // Slack, the dashboard and the documents page all link to /jobs?job=<id>,
  // and some of those ids are quotes. Rather than telling somebody the job is
  // not here, send them to where it now lives.
  const openJobIsQuote = openJob?.status === QUOTED_STATUS

  const searching = query.trim() !== ''

  const hasData = !loading && !error

  // A link from Slack can outlive the job it points at. Saying so beats a page
  // that silently ignores the id in the address bar.
  const linkedJobMissing = hasData && Boolean(openJobId) && !openJob

  if (openJobIsQuote) {
    return <Navigate to={`/quotes?job=${encodeURIComponent(openJobId)}`} replace />
  }

  return (
    <AppShell
      actions={(
        <>
          {/* One way in. Whether the quote is sent is chosen on the form, by
              which of its two buttons is pressed. */}
          <Link to="/jobs/new" className="btn-primary">New quote</Link>
        </>
      )}
    >
      <div className="jobs-page">

        {hasData && jobs.length > 0 && (
          <JobsSummary totals={totals} />
        )}

        {hasData && jobs.length > 0 && (
          <JobsToolbar
            status={status}
            onStatus={setStatus}
            query={query}
            onQuery={setQuery}
            testCount={testCount}
            showTest={showTest}
            onShowTest={setShowTest}
          />
        )}

        {hasData && jobs.length > 0 && (
          <JobsViewBanner viewKey={viewKey} view={view} count={inView.length} onClear={clearView} />
        )}

        {linkedJobMissing && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">That job is not here any more.</p>
            <p className="inv-error-detail">
              The link pointed at a job that has since been deleted, or one you cannot see.
            </p>
            <button type="button" className="btn-cancel" onClick={() => openJobById('')}>
              Show all jobs
            </button>
          </div>
        )}

        {loading && <p className="jobs-state">Loading jobs...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">Jobs could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              The jobs list reads the <code>job_margin</code> view. If it does not exist yet,
              apply <code>supabase/migrations/20260819000000_create_templates_bom.sql</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && jobs.length === 0 && (
          <EmptyState
            title="No jobs yet"
            actions={<Link to="/jobs/new" className="btn-primary">Write up your first job</Link>}
          >
            <p>
              A job is the unit everything else hangs off. Writing one up commits its parts
              from inventory, puts it on the schedule once it has a date, and starts the
              margin showing on the dashboard.
            </p>
            <p>
              If this is a fresh install, set up
              {' '}<Link to="/inventory" className="tpl-link">inventory</Link> and
              {' '}<Link to="/build-sheets" className="tpl-link">build sheets</Link> first, so a
              job knows what parts it consumes.
            </p>
          </EmptyState>
        )}

        {/* Which filter emptied the list matters. "No jobs with that status"
            over a search that found nothing sends somebody to the wrong
            control. */}
        {hasData && jobs.length > 0 && visible.length === 0
          && !(view && inView.length === 0) && (
          <EmptyState
            title={searching ? 'Nothing matched that search' : 'No jobs with that status'}
            tone="filtered"
            compact
          >
            <p>
              {searching ? (
                <>
                  Nothing matches &ldquo;{query.trim()}&rdquo;
                  {status !== ALL_STATUSES && (
                    <> among jobs that are {(STATUS_LABELS[status] || status).toLowerCase()}</>
                  )}. Search runs on the customer name, the address and the invoice number.
                </>
              ) : (
                <>
                  {inView.length} {inView.length === 1 ? 'job is' : 'jobs are'}
                  {view ? ' in this list' : ' here'}, but none are
                  {' '}{(STATUS_LABELS[status] || status).toLowerCase()}. Change the status
                  filter above to see the rest.
                </>
              )}
            </p>
          </EmptyState>
        )}

        {/* Nine columns, not ten. The city sits under the customer name,
            which is where the eye looks for it anyway, and the table fits the
            page instead of hiding the date behind a scrollbar. */}
        {hasData && visible.length > 0 && (
          <JobsTable
            jobs={visible}
            onOpen={openJobById}
            reasonFor={view?.reasonFor}
            sort={sort}
            onSort={col => setSort(current => sortStateFor(col, current))}
          />
        )}

        {hasData && visible.length > 0 && (
          <p className="inv-ledger-note">
            {GROSS} is price less parts less installer pay. A job that has installed takes
            its parts from the inventory ledger at the cost stamped on each row, and that
            figure never moves again. A job that has not takes them from its resolved parts
            list at today’s item costs, marked expected. A job whose list cannot name
            every part is not costed at all rather than costed optimistically. Click a job
            to install it or review what it consumed.
            {cancelledCount > 0 && (
              <> {cancelledCount} cancelled {cancelledCount === 1 ? 'job is' : 'jobs are'} shown
              but left out of the totals above.</>
            )}
          </p>
        )}
      </div>

      {openJob && (
        <JobDetailModal
          job={openJob}
          fixField={fixField}
          onClose={() => openJobById('')}
          onChanged={() => load()}
        />
      )}
    </AppShell>
  )
}
