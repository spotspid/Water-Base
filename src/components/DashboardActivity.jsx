import { Link } from 'react-router-dom'
import { useSettings } from '../lib/settings'
import { costEffect } from '../lib/dashboard'
import { formatCurrency, formatDateTime, formatSignedQty } from '../lib/inventory'

export default function DashboardActivity({ rows, limit }) {
  const { allTxnTypes } = useSettings()

  function typeLabel(value) {
    return allTxnTypes.find(t => t.value === value)?.label || value
  }

  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Recent Activity</h2>
        <Link to="/inventory" className="tpl-link">Ledger</Link>
      </header>

      {rows.length === 0 && (
        <p className="inv-state">
          Nothing has moved through the inventory ledger yet. Logging a purchase or installing
          a job will show up here.
        </p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Item</th>
                <th>Type</th>
                <th className="col-num">Qty</th>
                <th className="col-num">Value</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="col-nowrap">{formatDateTime(row.created_at)}</td>
                  <td className="td-customer">
                    {row.inventory_items?.sku || 'Unknown item'}
                    {row.inventory_items?.name && (
                      <span className="tpl-line-note">
                        {row.inventory_items.name}
                        {row.inventory_items.variant ? ` (${row.inventory_items.variant})` : ''}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`txn-badge txn-${row.txn_type}`}>{typeLabel(row.txn_type)}</span>
                  </td>
                  <td className={row.quantity < 0 ? 'col-num qty-out' : 'col-num qty-in'}>
                    {formatSignedQty(row.quantity)}
                  </td>
                  <td className="col-num col-value">{formatCurrency(costEffect(row))}</td>
                  <td className="tpl-detail">
                    {row.jobs?.customer_name
                      ? `${row.jobs.customer_name}${row.source === 'manual' ? '' : ` (auto, batch ${row.deduct_batch})`}`
                      : row.note || 'Manual entry'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="dash-panel-foot">
          The {rows.length === limit ? `${limit} most recent` : rows.length === 1 ? 'only' : `${rows.length}`}
          {' '}ledger {rows.length === 1 ? 'entry' : 'entries'}. Value is what each entry did to the
          money tied up in stock, at the cost stamped on that row.
        </p>
      )}
    </section>
  )
}
