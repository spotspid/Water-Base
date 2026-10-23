import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Shell from '../components/v2/Shell'
import { supabaseV2, adoptSession } from '../lib/supabaseV2'
import { supabase } from '../lib/supabase'
import { money } from '../lib/quote'
import {
  STATUS_LABEL, STATUS_ORDER, countByStatus, listTotals, needsLookingAt, sortJobs,
} from '../lib/jobList'
import './JobList.css'

// Where a quote goes after it is saved.
//
// One table and one filter. The thing it must not become is the list it
// replaces, which showed everything it knew and so showed nothing: eight
// installs sat unmarked on that page for three weeks with the dates in plain
// view.
//
// So one column earns its place by answering a question somebody actually
// asks. "Installed 25 days ago?" is a question. A date is not.

const COLUMNS = ['Customer', 'System', 'Status', 'When', 'Price']

export default function JobList() {
  const [jobs, setJobs] = useState([])
  const [status, setStatus] = useState('open')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    await adoptSession(supabase)

    const { data, error: readError } = await supabaseV2
      .from('jobs')
      .select('id, customer_name, city, system_template, status, scheduled_date, install_date, sale_price, invoice_number, created_at')
      .order('created_at', { ascending: false })

    if (readError) setError(`The jobs could not be loaded. ${readError.message}`)
    else setJobs(data || [])

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const counts = useMemo(() => countByStatus(jobs), [jobs])

  const shown = useMemo(() => {
    const picked = status === 'all'
      ? jobs
      : status === 'open'
        ? jobs.filter(j => j.status !== 'installed' && j.status !== 'cancelled')
        : jobs.filter(j => j.status === status)

    return sortJobs(picked)
  }, [jobs, status])

  const totals = useMemo(() => listTotals(shown), [shown])

  return (
    <Shell
      title="Jobs"
      actions={
        <span className="v2-sub">
          {loading ? 'Loading...' : `${shown.length} shown, ${money(totals.sold)} sold`}
          {totals.quoted > 0 && `, ${money(totals.quoted)} quoted`}
          {totals.unpriced > 0 && `, ${totals.unpriced} with no price`}
        </span>
      }
    >
      {error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button type="button" className="tpl-link" onClick={load}>Try again</button>
        </div>
      )}

      <div className="jl-filters" role="group" aria-label="Filter by status">
        <button
          type="button" onClick={() => setStatus('open')}
          className={status === 'open' ? 'jl-filter jl-filter-on' : 'jl-filter'}
        >
          Open
        </button>
        {STATUS_ORDER.map(key => (
          <button
            key={key} type="button" onClick={() => setStatus(key)}
            className={status === key ? 'jl-filter jl-filter-on' : 'jl-filter'}
          >
            {STATUS_LABEL[key]}
            {counts[key] > 0 && <span className="jl-filter-count">{counts[key]}</span>}
          </button>
        ))}
        <button
          type="button" onClick={() => setStatus('all')}
          className={status === 'all' ? 'jl-filter jl-filter-on' : 'jl-filter'}
        >
          All
        </button>
      </div>

      {!loading && shown.length === 0 && !error && (
        <p className="jl-empty">
          Nothing here yet. <Link to="/v2/quote">Start a quote</Link>.
        </p>
      )}

      {shown.length > 0 && (
        <div className="jl-table-wrap">
          <table className="jl-table">
            <thead>
              <tr>
                {COLUMNS.map(name => (
                  <th key={name} className={name === 'Price' ? 'jl-num' : undefined}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(job => {
                const flag = needsLookingAt(job)

                return (
                  <tr key={job.id}>
                    <td>
                      <span className="jl-name">{job.customer_name}</span>
                      {job.city && <span className="jl-city">{job.city}</span>}
                    </td>
                    <td className="jl-quiet">{job.system_template || 'Not chosen'}</td>
                    <td>
                      <span className={`jl-pill jl-pill-${job.status}`}>{STATUS_LABEL[job.status]}</span>
                    </td>
                    <td>
                      {flag
                        ? <span className="jl-flag">{flag}</span>
                        : <span className="jl-quiet">{job.scheduled_date || job.install_date || 'Not booked'}</span>}
                    </td>
                    <td className="jl-num">
                      {job.sale_price === null || job.sale_price === undefined
                        ? <span className="jl-quiet">Not priced</span>
                        : money(job.sale_price)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  )
}
