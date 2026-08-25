import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { formatCurrency, formatDateTime, formatSignedQty, withRunningBalance } from '../lib/inventory'
import ItemCostField from './ItemCostField'
import Modal from './Modal'

export default function ItemHistoryModal({ item, onClose, onChanged }) {
  const { allTxnTypes } = useSettings()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: err } = await supabase
        .from('inventory_transactions')
        .select('id, created_at, quantity, txn_type, reference, note, location, unit_cost_at_txn')
        .eq('item_id', item.id)
        .order('created_at', { ascending: false })

      if (err) {
        setError(err.message)
      } else {
        setRows(withRunningBalance(data || []))
      }
    } catch (caught) {
      setError(caught?.message || 'Could not reach the database. Check your connection and try again.')
    }
    setLoading(false)
  }, [item.id])

  useEffect(() => { load() }, [load])

  const subtitle = `${item.sku}${item.variant ? ` (${item.variant})` : ''} : ${item.on_hand} on hand`

  return (
    <Modal title={item.name} subtitle={subtitle} onClose={onClose} wide>
      <ItemCostField item={item} onChanged={onChanged} />

      {loading && <p className="inv-state">Loading history...</p>}

      {!loading && error && (
        <div className="inv-error-box" role="alert">
          <p className="inv-error-title">Could not load this item's history.</p>
          <p className="inv-error-detail">{error}</p>
          <button type="button" className="btn-cancel" onClick={load}>Try again</button>
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="inv-state">No transactions yet for this item.</p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th className="col-num">Qty</th>
                <th className="col-num">Balance</th>
                <th className="col-num">Unit Cost</th>
                <th>Reference</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="col-nowrap">{formatDateTime(row.created_at)}</td>
                  <td>
                    <span className={`txn-badge txn-${row.txn_type}`}>
                      {allTxnTypes.find(t => t.value === row.txn_type)?.label || row.txn_type}
                    </span>
                  </td>
                  <td className={row.quantity < 0 ? 'col-num qty-out' : 'col-num qty-in'}>
                    {formatSignedQty(row.quantity)}
                  </td>
                  <td className="col-num col-balance">{row.balance_after}</td>
                  <td className="col-num">
                    {row.unit_cost_at_txn == null ? '' : formatCurrency(row.unit_cost_at_txn)}
                  </td>
                  <td>{row.reference || ''}</td>
                  <td className="col-note">{row.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="inv-ledger-note">
        Balance is the running on hand total after each entry, summed from the ledger.
      </p>
    </Modal>
  )
}
