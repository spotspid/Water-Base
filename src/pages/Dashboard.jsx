import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import {
  billableJobs, inventoryUnits, inventoryValue, jobsSince, monthLabel, monthStart,
  reorderList, statusBreakdown, summarizeJobs,
} from '../lib/dashboard'
import AppShell from '../components/AppShell'
import DashboardActivity from '../components/DashboardActivity'
import DashboardLowStock from '../components/DashboardLowStock'
import DashboardMetrics from '../components/DashboardMetrics'
import DashboardStatus from '../components/DashboardStatus'
import './Dashboard.css'

const ACTIVITY_LIMIT = 12

const JOB_COLUMNS = 'id, created_at, status, sale_price, parts_cost, installer_pay, margin'

const STOCK_COLUMNS =
  'id, sku, name, category, variant, on_hand, reorder_threshold, unit_cost, stock_value, active'

const ACTIVITY_COLUMNS =
  'id, created_at, quantity, txn_type, unit_cost_at_txn, source, deduct_batch, note, ' +
  'inventory_items(sku, name, variant), jobs(customer_name)'

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
          .limit(ACTIVITY_LIMIT),
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
  const monthJobs = useMemo(() => billableJobs(jobsSince(jobs, start)), [jobs, start])
  const monthTotals = useMemo(() => summarizeJobs(monthJobs), [monthJobs])
  const statuses = useMemo(() => statusBreakdown(jobs), [jobs])
  const reorder = useMemo(() => reorderList(stock), [stock])

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
          <section className="dash-empty">
            <h2>Nothing to report yet</h2>
            <p>
              There are no jobs and no inventory items, so every figure below would be zero.
              The dashboard fills in on its own as real records arrive.
            </p>
            <ol className="dash-steps">
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
          </section>
        )}

        {hasData && !isEmpty && (
          <>
            <DashboardMetrics
              monthTotals={monthTotals}
              monthName={monthLabel(start)}
              inventoryValue={inventoryValue(stock)}
              inventoryUnits={inventoryUnits(stock)}
              itemCount={stock.length}
            />

            <div className="dash-columns">
              <DashboardStatus statuses={statuses} totalJobs={jobs.length} />
              <DashboardLowStock rows={reorder} itemCount={stock.length} />
            </div>

            <DashboardActivity rows={activity} limit={ACTIVITY_LIMIT} />
          </>
        )}
      </div>
    </AppShell>
  )
}
