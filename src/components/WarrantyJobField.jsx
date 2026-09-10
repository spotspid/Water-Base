import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { formatDay } from '../lib/inventory'

// The install a warranty replacement traces back to.
//
// Only installed jobs are offered, because a part cannot have failed in a
// house it never went into. Newest install first, since the part that just
// failed is more likely from last month than from last year.
const COLUMNS = 'id, customer_name, city, install_date, system_template, invoice_number'

function labelOf(job) {
  const when = job.install_date ? formatDay(job.install_date) : 'no install date'
  const where = job.city ? `, ${job.city}` : ''
  const number = job.invoice_number ? ` (${job.invoice_number})` : ''
  return `${job.customer_name}${where}: ${job.system_template}, ${when}${number}`
}

export default function WarrantyJobField({ value, onChange, disabled }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => supabase.from('job_margin').select(COLUMNS)
        .eq('status', 'installed')
        .order('install_date', { ascending: false, nullsFirst: false }),
      'The installed jobs could not be loaded.',
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

  return (
    <div className="field field-full">
      <label htmlFor="warranty_job_id">Original install</label>
      <select id="warranty_job_id" name="warranty_job_id" value={value}
        onChange={onChange} disabled={disabled || loading || Boolean(error)}>
        <option value="">
          {loading ? 'Loading installed jobs...' : 'Select the job it went in on...'}
        </option>
        {jobs.map(j => <option key={j.id} value={j.id}>{labelOf(j)}</option>)}
      </select>

      {error ? (
        <span className="form-error" role="alert">
          {error}
          {' '}
          <button type="button" className="tpl-link" onClick={load}>Try again</button>
        </span>
      ) : (
        <span className="field-hint">
          The job the failed part was installed on. Required, so the failure can be
          traced to when and where it went in. The job&apos;s own margin is not changed.
        </span>
      )}

      {!loading && !error && jobs.length === 0 && (
        <span className="form-warning" role="status">
          No job has been marked installed yet, so there is nothing to trace a failure to.
        </span>
      )}
    </div>
  )
}
