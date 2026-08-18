import { Link } from 'react-router-dom'
import { formatCurrency } from '../lib/inventory'

export default function DashboardLowStock({ rows, itemCount }) {
  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Needs Reorder</h2>
        <Link to="/inventory" className="tpl-link">Inventory</Link>
      </header>

      {itemCount === 0 && (
        <p className="inv-state">No inventory items yet, so nothing can run low.</p>
      )}

      {itemCount > 0 && rows.length === 0 && (
        <p className="inv-state">Everything is above its reorder threshold.</p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="col-num">On Hand</th>
                <th className="col-num">Threshold</th>
                <th className="col-num">Short By</th>
                <th className="col-num">Unit Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="td-customer">
                    {row.name}
                    <span className="tpl-line-note">
                      {[row.sku, row.variant].filter(Boolean).join(' : ')}
                    </span>
                  </td>
                  <td className="col-num">
                    <span className="inv-onhand">{row.on_hand}</span>
                  </td>
                  <td className="col-num">{row.reorder_threshold}</td>
                  <td className="col-num">
                    {row.shortfall > 0
                      ? <span className="dash-short">{row.shortfall}</span>
                      : <span className="dash-at-line">at the line</span>}
                  </td>
                  <td className="col-num">{formatCurrency(row.unit_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="dash-panel-foot">
          {rows.length} of {itemCount} {itemCount === 1 ? 'item is' : 'items are'} at or below
          the reorder threshold set on the item.
        </p>
      )}
    </section>
  )
}
