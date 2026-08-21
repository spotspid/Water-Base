import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { formatCurrency } from '../lib/inventory'
import { pickSourceLabel } from '../lib/templates'

// Shows the parts list a job will consume, with customer pick lines already
// resolved against the chosen finish. Used before the job exists on the new
// job form, and again before marking an existing job installed.
//
// committed says the job already exists and is holding these parts as a
// claim. On the new job form it is false, because nothing is claimed until
// the job is saved.
export default function JobPartsPreview({
  templateId, templateLabel, faucetFinish, committed = false,
}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!templateId) {
      setRows([])
      setError('')
      return
    }

    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => supabase.rpc('resolve_template_parts', {
        p_template_id: templateId,
        p_faucet_finish: faucetFinish || null,
      }),
      'The parts list could not be resolved.',
    )

    if (err) {
      setError(err)
      setRows([])
    } else {
      setRows(data || [])
    }

    setLoading(false)
  }, [templateId, faucetFinish])

  useEffect(() => { load() }, [load])

  const unresolved = rows.filter(r => !r.resolved)
  const total = rows.reduce((sum, r) => sum + (Number(r.line_cost) || 0), 0)

  if (!templateId) {
    return (
      <section className="job-parts">
        <h3>Parts To Deduct</h3>
        <p className="inv-state">
          {templateLabel
            ? `No template named "${templateLabel}" exists, so nothing would be deducted.`
            : 'Pick a system to see its parts list.'}
        </p>
      </section>
    )
  }

  return (
    <section className="job-parts">
      <h3>Parts To Deduct</h3>

      {loading && <p className="inv-state">Resolving parts...</p>}

      {!loading && error && (
        <div className="inv-error-box" role="alert">
          <p className="inv-error-detail">{error}</p>
          <button type="button" className="btn-cancel" onClick={load}>Try again</button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="inv-state">
          This template has no parts, so installing will not deduct anything.
        </p>
      )}

      {!loading && !error && unresolved.length > 0 && (
        <p className="form-error" role="alert">
          {unresolved.length} {unresolved.length === 1 ? 'line has' : 'lines have'} no matching
          inventory item for {faucetFinish ? `finish "${faucetFinish}"` : 'the chosen options'}.
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
                      : 'Template'}
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
          These parts are promised to this job now, which lowers what is free to sell
          without moving stock. They leave the shelf when the job is marked installed,
          and the claim is released if it is cancelled.
          {unresolved.length > 0 && ' A line with no matching item cannot be committed either, so it is not counted above.'}
        </p>
      )}
    </section>
  )
}
