import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { formatCurrency } from '../lib/inventory'
import { pickSourceLabel } from '../lib/templates'
import JobPartsOverride from './JobPartsOverride'

// The parts a saved job will consume, asked of the job rather than of its
// sheet.
//
// JobPartsPreview resolves a template plus three picks, which is the only
// thing the new job form can do, because there is no job yet. Once the job
// exists the question is different: a job may carry its own parts list, and
// then its sheet is not the answer. resolve_job_parts is what the reservation
// sync, the readiness report and the install deduction all ask, so this asks
// the same thing and cannot disagree with what will actually happen.
export default function JobParts({ job, committed, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const jobId = job.id

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => supabase.rpc('resolve_job_parts', { p_job_id: jobId }),
      'The parts list for this job could not be resolved.',
    )

    if (err) {
      setError(err)
      setRows([])
    } else {
      setRows(data || [])
    }

    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  // The claim follows an override edit inside the same transaction, so the
  // drawer's numbers are stale the moment one lands.
  const handleOverrideChanged = useCallback(() => {
    load()
    onChanged()
  }, [load, onChanged])

  const own = rows.some(r => r.source === 'job')
  const unresolved = rows.filter(r => !r.resolved)
  const total = rows.reduce((sum, r) => sum + (Number(r.line_cost) || 0), 0)

  return (
    <section className="job-parts">
      <h3>Parts to deduct</h3>

      {loading && <p className="inv-state">Resolving parts...</p>}

      {!loading && error && (
        <div className="inv-error-box" role="alert">
          <p className="inv-error-detail">{error}</p>
          <button type="button" className="btn-cancel" onClick={load}>Try again</button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="inv-state">
          {job.template_id
            ? `The build sheet "${job.system_template}" has no parts on it, so this job would `
              + 'install and record nothing. List its parts below, or put them on the sheet.'
            : 'This job has no build sheet and no parts of its own, so it would install and '
              + 'record nothing. List its parts below.'}
        </p>
      )}

      {!loading && !error && own && (
        <p className="inv-ledger-note">
          These are listed against this job, not on a build sheet. They are what it
          promises and what it will deduct.
        </p>
      )}

      {!loading && !error && unresolved.length > 0 && (
        <p className="form-error" role="alert">
          {unresolved.length} {unresolved.length === 1 ? 'line has' : 'lines have'} no matching
          inventory item for the choices on this job.
          Installing will be refused until the item exists, and nothing will be partly deducted.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Source</th>
                <th className="col-num">Qty</th>
                <th className="col-num">Unit Cost</th>
                <th className="col-num">Line Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.line_id} className={r.resolved ? '' : 'job-parts-missing'}>
                  <td className="td-customer">
                    {r.resolved
                      ? <>{r.sku} <span className="tpl-line-note">{r.item_name}{r.item_variant ? ` (${r.item_variant})` : ''}</span></>
                      : <span className="job-parts-none">No matching {r.pick_category} item</span>}
                  </td>
                  <td>
                    {r.line_type === 'customer_pick'
                      ? <span className="tpl-pick-badge">{pickSourceLabel(r.pick_source)}</span>
                      : r.source === 'job' ? <span className="tpl-pick-badge">This job</span> : 'Build sheet'}
                  </td>
                  <td className="col-num">{r.quantity}</td>
                  <td className="col-num">{r.resolved ? formatCurrency(r.unit_cost) : ''}</td>
                  <td className="col-num col-value">{r.resolved ? formatCurrency(r.line_cost) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="4" className="col-total-label">Parts cost at current item costs</td>
                <td className="col-num col-value">{formatCurrency(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!loading && !error && committed && rows.length > 0 && (
        <p className="inv-ledger-note">
          These parts are promised to this job now, which lowers what is available
          without moving stock. They leave the shelf when the job is marked installed,
          and they are released if it is cancelled.
          {unresolved.length > 0 && ' A line with no matching item cannot be promised either, so it is not counted above.'}
        </p>
      )}

      <JobPartsOverride job={job} onChanged={handleOverrideChanged} />
    </section>
  )
}
