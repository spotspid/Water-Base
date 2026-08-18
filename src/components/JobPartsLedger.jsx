import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { formatCurrency, formatDateTime, formatSignedQty } from '../lib/inventory'

// Every inventory row tied to this job, template written or manual, with the
// cost effect each one had. refreshKey is bumped by the parent after an
// install or a reversal so the table reloads without remounting.
export default function JobPartsLedger({ jobId, refreshKey }) {
  const [txns, setTxns] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => supabase
        .from('inventory_transactions')
        .select('id, created_at, quantity, txn_type, unit_cost_at_txn, source, deduct_batch, inventory_items(sku, name, variant)')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true }),
      'The parts used on this job could not be loaded.',
    )

    if (err) {
      setError(err)
      setTxns([])
    } else {
      setTxns(data || [])
    }

    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load, refreshKey])

  const total = useMemo(
    () => txns.reduce((sum, t) => sum + -Number(t.quantity || 0) * Number(t.unit_cost_at_txn || 0), 0),
    [txns],
  )

  return (
    <section className="job-action">
      <h3>Parts Ledger</h3>

      {loading && <p className="inv-state">Loading parts...</p>}

      {!loading && error && (
        <div className="inv-error-box" role="alert">
          <p className="inv-error-detail">{error}</p>
          <button type="button" className="btn-cancel" onClick={load}>Try again</button>
        </div>
      )}

      {!loading && !error && txns.length === 0 && (
        <p className="inv-state">No inventory has been consumed for this job.</p>
      )}

      {!loading && !error && txns.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Type</th>
                <th className="col-num">Qty</th>
                <th className="col-num">Unit Cost</th>
                <th className="col-num">Cost Effect</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {txns.map(t => (
                <tr key={t.id}>
                  <td className="col-nowrap">{formatDateTime(t.created_at)}</td>
                  <td className="td-customer">
                    {t.inventory_items?.sku || 'Unknown item'}
                    {t.inventory_items?.name && (
                      <span className="tpl-line-note">
                        {t.inventory_items.name}
                        {t.inventory_items.variant ? ` (${t.inventory_items.variant})` : ''}
                      </span>
                    )}
                  </td>
                  <td><span className={`txn-badge txn-${t.txn_type}`}>{t.txn_type}</span></td>
                  <td className={t.quantity < 0 ? 'col-num qty-out' : 'col-num qty-in'}>
                    {formatSignedQty(t.quantity)}
                  </td>
                  <td className="col-num">
                    {t.unit_cost_at_txn == null ? '' : formatCurrency(t.unit_cost_at_txn)}
                  </td>
                  <td className="col-num col-value">
                    {formatCurrency(-Number(t.quantity || 0) * Number(t.unit_cost_at_txn || 0))}
                  </td>
                  <td className="col-nowrap">
                    {t.source === 'manual' ? 'Manual' : `Template batch ${t.deduct_batch}`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="5" className="col-total-label">Parts cost from ledger</td>
                <td className="col-num col-value">{formatCurrency(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}
