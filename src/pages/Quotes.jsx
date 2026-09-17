import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { QUOTED_STATUS } from '../lib/constants'
import { JOB_MARGIN_COLUMNS } from '../lib/jobColumns'
import { realJobs } from '../lib/dashboard'
import { agreementLabel, agreementTone } from '../lib/agreements'
import { formatCurrency } from '../lib/inventory'
import { daysSinceQuoteSent, quotesOut } from '../lib/quotes'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import JobDetailModal from '../components/JobDetailModal'
// The quotes list is the jobs table and the same job drawer, and their rules
// live in Jobs.css. Vite ships one stylesheet per route, so without this they
// would render bare here with nothing erroring. check:styles is what caught it.
import './Jobs.css'

// Quotes, before they are sales.
//
// A quote is a price nobody has agreed to, so it is not a job on the jobs
// list and it is in none of the money there. It has its own page instead,
// with the five things worth reading down a column of prices somebody is
// waiting on: who, what, how much, where the paperwork is, and how long ago
// it was written.
//
// ?view=out narrows to quotes that have gone out and are not signed, which is
// what the dashboard tile counts, so the tile's number and this list are the
// same rule rather than two that can drift.
//
// ?job=<id> opens the drawer, the same as on the jobs page, so a link from
// Slack or the dashboard lands on the quote itself.
export default function Quotes() {
  const [params, setParams] = useSearchParams()
  const openJobId = params.get('job') || ''
  const outOnly = params.get('view') === 'out'

  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showTest, setShowTest] = useState(false)

  const openJobById = useCallback(id => {
    setParams(current => {
      const next = new URLSearchParams(current)
      if (id) next.set('job', id)
      else next.delete('job')
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
        .eq('status', QUOTED_STATUS)
        .order('created_at', { ascending: false }),
      'Quotes could not be loaded.',
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

  const testCount = useMemo(() => jobs.length - realJobs(jobs).length, [jobs])
  const shown = useMemo(() => (showTest ? jobs : realJobs(jobs)), [jobs, showTest])
  const visible = useMemo(() => (outOnly ? quotesOut(shown) : shown), [shown, outOnly])

  // The drawer resolves against every quote loaded, not the filtered list, so
  // a link to a quote still opens while a narrowing view is on.
  const openJob = useMemo(() => jobs.find(j => j.id === openJobId) || null, [jobs, openJobId])
  const hasData = !loading && !error
  const missing = hasData && Boolean(openJobId) && !openJob

  return (
    <AppShell actions={<Link to="/jobs/new" className="btn-primary">New quote</Link>}>
      <div className="jobs-page">

        {loading && <p className="inv-state">Loading quotes...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">Quotes could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {/* A quote can be sold or cancelled from its drawer, so a link can
            outlive the quote it points at. */}
        {missing && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">That quote is not here any more.</p>
            <p className="inv-error-detail">
              It may have been sold, cancelled or removed. Sold and booked work is on the
              {' '}<Link to="/jobs" className="tpl-link">jobs page</Link>.
            </p>
            <button type="button" className="btn-cancel" onClick={() => openJobById('')}>Close</button>
          </div>
        )}

        {hasData && outOnly && (
          <p className="inv-ledger-note">
            Showing quotes that have gone out and are not signed.
            {' '}<Link to="/quotes" className="tpl-link">Show every quote</Link>
          </p>
        )}

        {hasData && testCount > 0 && (
          <div className="inv-toolbar">
            <label className="inv-filter jobs-show-test">
              <input type="checkbox" checked={showTest} onChange={e => setShowTest(e.target.checked)} />
              {' '}Show test quotes ({testCount})
            </label>
          </div>
        )}

        {hasData && visible.length === 0 && (
          <EmptyState title={outOnly ? 'No quotes are out' : 'No quotes yet'} compact>
            <p>
              {outOnly
                ? 'Every quote has either been signed or has not been sent yet.'
                : 'A quote appears here as soon as one is written up. Sold and booked work is on the jobs page.'}
            </p>
          </EmptyState>
        )}

        {hasData && visible.length > 0 && (
          <div className="table-wrap">
            <table className="jobs-table jobs-list">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Build sheet</th>
                  <th className="col-num">Price</th>
                  <th>Agreement</th>
                  <th>Written up</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(job => {
                  const days = daysSinceQuoteSent(job)
                  return (
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
                      <td>
                        <span className={`agr-badge agr-${agreementTone(job)}`}>
                          {agreementLabel(job)}
                        </span>
                        {days != null && (
                          <span className="cell-sub">
                            sent {days === 0 ? 'today' : `${days} ${days === 1 ? 'day' : 'days'} ago`}
                          </span>
                        )}
                      </td>
                      <td className="col-nowrap">
                        {new Date(job.created_at).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {hasData && visible.length > 0 && (
          <p className="inv-ledger-note">
            A quote is a price nobody has agreed to, so none of this counts as revenue or
            gross profit. Open one to send it, chase it, or mark it sold, and it moves to
            the jobs page.
          </p>
        )}
      </div>

      {openJob && (
        <JobDetailModal
          job={openJob}
          onClose={() => openJobById('')}
          onChanged={() => load()}
        />
      )}
    </AppShell>
  )
}
