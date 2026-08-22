import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import {
  atReorderPoint, bookedWithin, groupActivity, inventoryUnits, inventoryValue,
  monthLabel, monthStart, pipelineSummary, soldNotBooked, splitMonthRevenue,
  stockShortages,
} from '../lib/dashboard'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import DashboardActivity from '../components/DashboardActivity'
import DashboardMetrics from '../components/DashboardMetrics'
import DashboardShortages from '../components/DashboardShortages'
import './Dashboard.css'

// five entries is enough to answer "what just happened". The Ledger link
// covers the rest.
const ACTIVITY_LIMIT = 5

// Rows are fetched, entries are shown, and one job's install can be any number
// of rows. Fetching a generous window means five entries are still five
// distinct things after grouping, rather than one install and nothing else.
const ACTIVITY_FETCH = 60

const BOOKING_DAYS = 14

// install_date matters as much as created_at now. Sold revenue is dated by
// the day a job was written, installed revenue by the day it happened, so a
// job sold in one month and installed in the next lands in the right month on
// both counts.
const JOB_COLUMNS =
  'id, created_at, status, scheduled_date, install_date, sale_price, parts_cost, ' +
  'installer_pay, margin'

// committed and available are what the reservation layer contributes, and the
// meter is meaningless without them. They were missing here, and because
// committedOf and availableOf are written to survive a database one migration
// behind, the absent columns read as a confident zero rather than an error:
// every row showed "none promised" while eight reservations were open.
const STOCK_COLUMNS =
  'id, sku, name, category, variant, on_hand, reorder_threshold, unit_cost, ' +
  'stock_value, active, committed, available'

// job_id is what folds five part rows into one install. Without it the panel
// can join to a customer name but cannot tell two jobs apart.
const ACTIVITY_COLUMNS =
  'id, created_at, quantity, txn_type, unit_cost_at_txn, source, deduct_batch, note, ' +
  'job_id, inventory_items(sku, name, variant), jobs(customer_name)'

export default function Dashboard() {
  const [jobs, setJobs] = useState([])
  const [stock, setStock] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [jobRes, stockRes, activityRes] = await Promise.all([
      attempt(
        () => supabase.from('job_margin').select(JOB_COLUMNS).order('created_at', { ascending: false }),
        'Job figures could not be loaded.',
      ),
      attempt(
        () => supabase.from('inventory_stock').select(STOCK_COLUMNS),
        'Inventory could not be loaded.',
      ),
      attempt(
        () => supabase
          .from('inventory_transactions')
          .select(ACTIVITY_COLUMNS)
          .order('created_at', { ascending: false })
          .limit(ACTIVITY_FETCH),
        'Recent activity could not be loaded.',
      ),
    ])

    const firstError = jobRes.error || stockRes.error || activityRes.error

    if (firstError) {
      setError(firstError)
      setJobs([])
      setStock([])
      setActivity([])
    } else {
      setJobs(jobRes.data || [])
      setStock(stockRes.data || [])
      setActivity(activityRes.data || [])
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const start = useMemo(() => monthStart(), [])
  const revenue = useMemo(() => splitMonthRevenue(jobs, start), [jobs, start])
  const pipeline = useMemo(() => pipelineSummary(jobs), [jobs])
  const notBooked = useMemo(() => soldNotBooked(jobs).length, [jobs])
  const bookedSoon = useMemo(() => bookedWithin(jobs, BOOKING_DAYS).length, [jobs])
  const shortages = useMemo(() => stockShortages(stock), [stock])
  const atLine = useMemo(() => atReorderPoint(stock), [stock])
  const allEntries = useMemo(() => groupActivity(activity), [activity])
  const entries = useMemo(() => allEntries.slice(0, ACTIVITY_LIMIT), [allEntries])

  const hasData = !loading && !error
  const isEmpty = hasData && jobs.length === 0 && stock.length === 0

  return (
    <AppShell>
      <div className="dash-page">
        <div className="dash-header">
          <div>
            <h1>Dashboard</h1>
            <p className="dash-sub">{monthLabel(start)} to date</p>
          </div>
          <button type="button" className="btn-cancel" onClick={load} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {loading && <p className="inv-state">Loading dashboard...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">The dashboard could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              Every figure here is read from the database. If the views are missing, apply the
              migrations in <code>supabase/migrations</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {isEmpty && (
          <EmptyState title="Nothing to report yet">
            <p>
              There are no jobs and no inventory items, so every figure below would be zero.
              The dashboard fills in on its own as real records arrive.
            </p>
            <ol className="empty-state-steps">
              <li>
                <Link to="/settings">Check your settings</Link>, so categories, cities and the
                installer pay rate match how you actually work.
              </li>
              <li>
                <Link to="/inventory">Add inventory items</Link> and log a purchase, which gives
                you stock on hand and a value to track.
              </li>
              <li>
                <Link to="/templates">Put parts on a template</Link>, so installing a job deducts
                the right stock automatically.
              </li>
              <li>
                <Link to="/jobs/new">Write up a job</Link>. Revenue and margin appear here as soon
                as it is saved.
              </li>
            </ol>
          </EmptyState>
        )}

        {hasData && !isEmpty && (
          <>
            <DashboardMetrics
              sold={revenue.sold}
              installed={revenue.installed}
              monthName={monthLabel(start)}
              notBooked={notBooked}
              bookedSoon={bookedSoon}
              bookingDays={BOOKING_DAYS}
              inventoryValue={inventoryValue(stock)}
              inventoryUnits={inventoryUnits(stock)}
              itemCount={stock.length}
            />

            {/* What used to be a panel with two bars in it. The counts were
                the whole content, so they are a sentence now. */}
            {pipeline.total > 0 && (
              <p className="dash-pipeline">
                <Link to="/jobs" className="tpl-link">{pipeline.total} {pipeline.total === 1 ? 'job' : 'jobs'}</Link>
                {' '}all time:
                {' '}{pipeline.used.map(row => `${row.count} ${row.label.toLowerCase()}`).join(', ')}.
                {pipeline.empty.length > 0 && (
                  <> Nothing is {pipeline.empty.join(' or ')} yet.</>
                )}
              </p>
            )}

            <DashboardShortages
              rows={shortages}
              itemCount={stock.length}
              atLineCount={atLine.length}
            />

            <DashboardActivity
              entries={entries}
              limit={ACTIVITY_LIMIT}
              totalEntries={allEntries.length}
            />
          </>
        )}
      </div>
    </AppShell>
  )
}
