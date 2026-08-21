import { Link } from 'react-router-dom'
import StockMeter from './StockMeter'

export default function DashboardLowStock({ rows, itemCount }) {
  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Running low</h2>
        <span className="dash-panel-note">
          Teal is free to sell, hatched navy is promised to a booked job
        </span>
        <Link to="/inventory" className="tpl-link">Inventory</Link>
      </header>

      {itemCount === 0 && (
        <p className="inv-state">No inventory items yet, so nothing can run low.</p>
      )}

      {itemCount > 0 && rows.length === 0 && (
        <p className="inv-state">Everything is above its reorder point.</p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Part</th>
                <th className="col-meter">Available</th>
                <th className="col-num">On hand</th>
                <th className="col-num">Reorder at</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td className="td-customer">
                    {row.name}
                    <span className="cell-sub">
                      {[row.sku, row.variant].filter(Boolean).join(', ')}
                    </span>
                  </td>
                  <td className="col-meter"><StockMeter row={row} /></td>
                  <td className="col-num">
                    <span className="inv-onhand">{row.on_hand}</span>
                  </td>
                  <td className="col-num">{row.reorder_threshold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="dash-panel-foot">
          {rows.length} of {itemCount} {itemCount === 1 ? 'item is' : 'items are'} at or below
          the reorder point set on the item.
        </p>
      )}
    </section>
  )
}
