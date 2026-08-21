import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { STATUS_LABELS } from '../lib/constants'
import { billableJobs } from '../lib/dashboard'
import { attempt } from '../lib/errors'
import { formatCurrency } from '../lib/inventory'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import JobDetailModal from '../components/JobDetailModal'
import './Jobs.css'

const ALL_STATUSES = 'all'

const JOB_MARGIN_COLUMNS =
  'id, created_at, customer_name, city, system_template, template_id, status, install_date, ' +
  'installer, invoice_number, faucet_finish, parts_deducted_at, parts_deduct_batch, ' +
  'sale_price, installer_pay, parts_cost, parts_count, margin, margin_pct, ' +
  'address, phone, scheduled_date, time_window, installer_id, installer_name, ' +
  'helper_id, helper_name'

export default function Jobs() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(ALL_STATUSES)
  const [openJobId, setOpenJobId] = useState('')

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

  const visible = useMemo(
    () => (status === ALL_STATUSES ? jobs : jobs.filter(j => j.status === status)),
    [jobs, status],
  )

  // Cancelled jobs stay in the list and in the status filter, but never in
  // the money. A cancelled sale that still counted as revenue would overstate
  // every total on this bar.
  const counted = useMemo(() => billableJobs(visible), [visible])

  const cancelledCount = visible.length - counted.length

  const totals = useMemo(() => counted.reduce((acc, j) => ({
    revenue: acc.revenue + (Number(j.sale_price) || 0),
    parts: acc.parts + (Number(j.parts_cost) || 0),
    pay: acc.pay + (Number(j.installer_pay) || 0),
    margin: acc.margin + (Number(j.margin) || 0),
  }), { revenue: 0, parts: 0, pay: 0, margin: 0 }), [counted])

  const openJob = useMemo(
    () => jobs.find(j => j.id === openJobId) || null,
    [jobs, openJobId],
  )

  const hasData = !loading && !error

  return (
    <AppShell>
      <div className="jobs-page">
        <div className="jobs-header">
          <h1>Jobs</h1>
          <Link to="/jobs/new" className="btn-primary">+ New Job</Link>
        </div>

        {hasData && jobs.length > 0 && (
          <div className="inv-summary">
            <div className="inv-stat inv-stat-lead">
              <span className="inv-stat-label">Margin</span>
              <span className="inv-stat-value">{formatCurrency(totals.margin)}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Revenue</span>
              <span className="inv-stat-value">{formatCurrency(totals.revenue)}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Parts</span>
              <span className="inv-stat-value">{formatCurrency(totals.parts)}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Installer Pay</span>
              <span className="inv-stat-value">{formatCurrency(totals.pay)}</span>
            </div>
            <div className="inv-filter">
              <label htmlFor="status-filter">Status</label>
              <select id="status-filter" value={status} onChange={e => setStatus(e.target.value)}>
                <option value={ALL_STATUSES}>All statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
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
              {' '}<Link to="/templates" className="tpl-link">templates</Link> first, so a
              job knows what parts it consumes.
            </p>
          </EmptyState>
        )}

        {hasData && jobs.length > 0 && visible.length === 0 && (
          <EmptyState title="No jobs with that status" tone="filtered" compact>
            <p>
              {jobs.length} {jobs.length === 1 ? 'job exists' : 'jobs exist'}, but none are
              {' '}{(STATUS_LABELS[status] || status).toLowerCase()}. Change the status
              filter above to see the rest.
            </p>
          </EmptyState>
        )}

        {hasData && visible.length > 0 && (
          <div className="table-wrap">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>City</th>
                  <th>System</th>
                  <th className="col-num">Price</th>
                  <th className="col-num">Parts</th>
                  <th className="col-num">Pay</th>
                  <th className="col-num">Margin</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(job => (
                  <tr key={job.id} className="inv-row" tabIndex={0}
                    onClick={() => setOpenJobId(job.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenJobId(job.id)
                      }
                    }}>
                    <td className="td-customer">{job.customer_name}</td>
                    <td>{job.city}</td>
                    <td>{job.system_template}</td>
                    <td className="col-num">{formatCurrency(job.sale_price)}</td>
                    <td className="col-num">
                      {formatCurrency(job.parts_cost)}
                      {job.status === 'installed' && !job.parts_deducted_at && (
                        <span className="inv-low" title="Installed without a template deduction">Manual</span>
                      )}
                    </td>
                    <td className="col-num">{formatCurrency(job.installer_pay)}</td>
                    <td className={Number(job.margin) < 0 ? 'col-num col-value job-margin-bad' : 'col-num col-value'}>
                      {formatCurrency(job.margin)}
                      {job.margin_pct != null && (
                        <span className="job-margin-pct">{Number(job.margin_pct).toFixed(0)}%</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge status-${job.status}`}>
                        {STATUS_LABELS[job.status] || job.status}
                      </span>
                    </td>
                    <td className="col-nowrap">
                      {new Date(job.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasData && visible.length > 0 && (
          <p className="inv-ledger-note">
            Margin is price minus parts minus installer pay. Parts come from the inventory
            ledger at the cost stamped on each transaction. A job that is sold or scheduled
            has its parts committed but not yet deducted. Click a job to install it or
            review what it consumed.
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
          onClose={() => setOpenJobId('')}
          onChanged={() => load()}
        />
      )}
    </AppShell>
  )
}
