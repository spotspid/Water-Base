import { Link } from 'react-router-dom'
import StockMeter from './StockMeter'

// Parts that need attention, worst first.
//
// Two different problems share this panel, so each row says which one it has.
// Nothing free means every unit is promised to a booked job and there is none
// left to sell today. At the line means the shelf has fallen to the reorder
// point, which is a purchasing problem rather than a selling one.
export default function DashboardLowStock({ rows, itemCount }) {
  const noneFree = rows.filter(row => row.urgency === 'none-free').length

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
        <p className="inv-state">
          Every part is above its reorder point with stock free to sell.
        </p>
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
                <th>Why</th>
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
                  <td>
                    {row.urgency === 'none-free'
                      ? <span className="pill pill-red">Nothing free</span>
                      : <span className="pill pill-amber">At the line</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <p className="dash-panel-foot">
          {rows.length} of {itemCount} {itemCount === 1 ? 'part needs' : 'parts need'} attention.
          {noneFree > 0 && (
            <> {noneFree} {noneFree === 1 ? 'has' : 'have'} nothing free to sell, because every
            unit on the shelf is promised to a booked job.</>
          )}
        </p>
      )}
    </section>
  )
}
