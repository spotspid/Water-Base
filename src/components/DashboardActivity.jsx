import { Link } from 'react-router-dom'
import { useSettings } from '../lib/settings'
import { costEffect } from '../lib/dashboard'
import { formatCurrency, formatDateTime, formatDay, formatSignedQty } from '../lib/inventory'

// The last few things that moved through the ledger.
//
// The When column shows the day rather than a clock time. The ledger's grain
// is the day, and several rows were back loaded from an invoice date with no
// real time attached, so printing one would be inventing it. The full instant
// is on the cell's tooltip for anyone who needs it.
//
// Reason is left blank when there is nothing to say. It used to fall back to
// "Manual entry", which was true of almost every row and so told nobody
// anything, while making the column look full of content.
export default function DashboardActivity({ rows, limit }) {
  const { allTxnTypes } = useSettings()

  function typeLabel(value) {
    return allTxnTypes.find(t => t.value === value)?.label || value
  }

  function reason(row) {
    if (row.jobs?.customer_name) {
      return row.source === 'manual'
        ? row.jobs.customer_name
        : `${row.jobs.customer_name}, auto`
    }
    return row.note || ''
  }

  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Recent activity</h2>
        <span className="dash-panel-note">
          Every stock change is a ledger entry, nothing is edited in place
        </span>
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
                <th>Part</th>
                <th>Type</th>
                <th className="col-num">Qty</th>
                <th className="col-num">Value</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="col-nowrap" title={formatDateTime(row.created_at)}>
                    {formatDay(row.created_at)}
                  </td>
                  <td className="td-customer">
                    {row.inventory_items?.name || 'Unknown item'}
                    {row.inventory_items?.sku && (
                      <span className="cell-sub">
                        {row.inventory_items.sku}
                        {row.inventory_items.variant ? `, ${row.inventory_items.variant}` : ''}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`txn-badge txn-${row.txn_type}`}>{typeLabel(row.txn_type)}</span>
                  </td>
                  <td className={row.quantity < 0 ? 'col-num qty-out' : 'col-num qty-in'}>
                    {formatSignedQty(row.quantity)}
                  </td>
                  <td className={costEffect(row) < 0 ? 'col-num col-value qty-out' : 'col-num col-value qty-in'}>
                    {formatCurrency(costEffect(row))}
                  </td>
                  <td className="col-note">{reason(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="dash-panel-foot">
          The {rows.length === limit ? `${limit} most recent` : rows.length === 1 ? 'only' : rows.length}
          {' '}ledger {rows.length === 1 ? 'entry' : 'entries'}. Value is what each one did to the
          money tied up in stock, at the cost stamped on that row.
        </p>
      )}
    </section>
  )
}
