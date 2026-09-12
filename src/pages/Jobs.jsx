import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { STATUS_LABELS } from '../lib/constants'
import { agreementLabel, agreementTone } from '../lib/agreements'
import { billableJobs } from '../lib/dashboard'
import { GROSS, NOT_COSTED, basisTag, canShowProfit, profitTotals } from '../lib/profit'
import { attempt } from '../lib/errors'
import { formatCurrency } from '../lib/inventory'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import JobDetailModal from '../components/JobDetailModal'
import JobsSummary from '../components/JobsSummary'
import './Jobs.css'

const ALL_STATUSES = 'all'

const JOB_MARGIN_COLUMNS =
  'id, created_at, customer_name, city, system_template, template_id, status, install_date, ' +
  'installer, invoice_number, faucet_finish, parts_deducted_at, parts_deduct_batch, ' +
  'sale_price, installer_pay, parts_cost, parts_count, margin, margin_pct, ' +
  'address, phone, scheduled_date, time_window, installer_id, installer_name, ' +
  'helper_id, helper_name, customer_email, agreement_status, agreement_signed_url, ' +
  'agreement_id, agreement_sent_at, agreement_completed_at, agreement_audit_log_url, ' +
  'agreement_last_error, agreement_send_count, ro_type, ' +
  'work_order_id, work_order_status, work_order_sent_at, work_order_completed_at, ' +
  'work_order_signed_url, work_order_audit_log_url, work_order_last_error, ' +
  'work_order_send_count, installer_email, site_conditions, ' +
  'agreement_view_count, work_order_view_count, nag_snoozed_until, ' +
  'deposits_taken, deposit_count, last_deposit_on, balance_due, template_line_count, ' +
  'collected_by, valve_type, payment_type, water_source, notes, payout_amount, has_job_parts, ' +
  'expected_parts_cost, parts_cost_effective, parts_cost_basis, unresolved_lines'

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

  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState(ALL_STATUSES)

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

  const visible = useMemo(
    () => (status === ALL_STATUSES ? jobs : jobs.filter(j => j.status === status)),
    [jobs, status],
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

  const hasData = !loading && !error

  // A link from Slack can outlive the job it points at. Saying so beats a page
  // that silently ignores the id in the address bar.
  const linkedJobMissing = hasData && Boolean(openJobId) && !openJob

  return (
    <AppShell>
      <div className="jobs-page">

        {hasData && jobs.length > 0 && (
          <JobsSummary totals={totals} />
        )}

        {hasData && jobs.length > 0 && (
          <div className="inv-toolbar">
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

        {/* Nine columns, not ten. The city sits under the customer name,
            which is where the eye looks for it anyway, and the table fits the
            page instead of hiding the date behind a scrollbar. */}
        {hasData && visible.length > 0 && (
          <div className="table-wrap">
            <table className="jobs-table jobs-list">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>System</th>
                  <th className="col-num">Price</th>
                  <th className="col-num">Parts</th>
                  <th className="col-num">Pay</th>
                  <th className="col-num">{GROSS}</th>
                  <th>Status</th>
                  <th>Agreement</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(job => (
                  <tr key={job.id} className="inv-row" tabIndex={0}
                    onClick={() => openJobById(job.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openJobById(job.id)
                      }
                    }}>
                    <td className="td-customer">
                      {job.customer_name}
                      <span className="cell-sub">
                        {job.city || <span className="cell-unset">City not set</span>}
                      </span>
                    </td>
                    <td>{job.system_template}</td>
                    <td className="col-num">{formatCurrency(job.sale_price)}</td>
                    <td className="col-num">
                      {/* The ledger figure once it has installed, the resolved
                          list before that, and never a zero standing in for
                          "nobody has costed this". */}
                      {job.parts_cost_effective == null ? (
                        <span className="cell-unset">not costed</span>
                      ) : (
                        <>
                          {formatCurrency(job.parts_cost_effective)}
                          {basisTag(job.parts_cost_basis) && (
                            <span className="cell-basis">{basisTag(job.parts_cost_basis)}</span>
                          )}
                        </>
                      )}
                      {job.status === 'installed' && !job.parts_deducted_at && (
                        <span className="inv-low" title="Installed without a template deduction">Manual</span>
                      )}
                    </td>
                    <td className="col-num">{formatCurrency(job.installer_pay)}</td>
                    <td className={Number(job.margin) < 0 ? 'col-num col-value job-margin-bad' : 'col-num col-value'}>
                      {canShowProfit(job.parts_cost_basis) && job.margin != null ? (
                        <>
                          {formatCurrency(job.margin)}
                          {job.margin_pct != null && (
                            <span className="job-margin-pct">{Number(job.margin_pct).toFixed(0)}%</span>
                          )}
                          {basisTag(job.parts_cost_basis) && (
                            <span className="cell-basis">{basisTag(job.parts_cost_basis)}</span>
                          )}
                        </>
                      ) : (
                        /* A blank that says so, rather than the whole sale price
                           dressed up as profit. */
                        <span className="cell-unset">{NOT_COSTED}</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge status-${job.status}`}>
                        {STATUS_LABELS[job.status] || job.status}
                      </span>
                    </td>
                    <td>
                      <span className={`agr-badge agr-${agreementTone(job)}`}>
                        {agreementLabel(job)}
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
