import { Link } from 'react-router-dom'
import { committedOf } from '../lib/inventory'
import StockMeter from './StockMeter'

// Parts with nothing free to sell.
//
// This panel used to carry two different problems at once and could not tell
// them apart in the count. Eight of eleven parts read as needing attention,
// six of them only because on hand had reached a reorder point that had been
// set by category rather than by what a job consumes. A list where most of the
// catalog is a warning is not a warning.
//
// What is left is the one thing that stops a sale today: every unit on the
// shelf is promised to a booked job, or more is promised than exists. Parts
// that have merely reached their reorder point are on Inventory, next to the
// button that does something about them.
export default function DashboardShortages({ rows, itemCount, atLineCount }) {
  const oversold = rows.filter(row => row.free < 0).length

  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Short on stock</h2>
        <span className="dash-panel-note">
          Teal is free to sell, hatched navy is promised to a booked job
        </span>
        <Link to="/inventory" className="tpl-link">Inventory</Link>
      </header>

      {itemCount === 0 && (
        <p className="inv-state">No inventory items yet, so nothing can be short.</p>
      )}

      {itemCount > 0 && rows.length === 0 && (
        <p className="dash-clear">
          Nothing is short. Every part has stock free to sell after what is already
          promised to booked jobs.
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
                <th className="col-num">Promised</th>
                <th className="col-num">Free</th>
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
                  <td className="col-num"><span className="inv-onhand">{row.on_hand}</span></td>
                  <td className="col-num">{committedOf(row)}</td>
                  <td className="col-num col-value">
                    {row.free < 0
                      ? <span className="pill pill-red">{row.free} oversold</span>
                      : <span className="pill pill-amber">None free</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(rows.length > 0 || atLineCount > 0) && (
      <p className="dash-panel-foot">
        {rows.length > 0 && (
          <>
            {rows.length} of {itemCount} {rows.length === 1 ? 'part has' : 'parts have'} nothing
            free to sell. The stock is on the shelf, it is just already spoken for.
            {oversold > 0 && (
              <> {oversold} {oversold === 1 ? 'is' : 'are'} promised beyond what the shelf holds.</>
            )}
          </>
        )}
        {atLineCount > 0 && (
          <>
            {' '}{atLineCount} other {atLineCount === 1 ? 'part has' : 'parts have'} reached
            {' '}{atLineCount === 1 ? 'its' : 'their'} reorder point with stock still free.
            {' '}<Link to="/inventory" className="tpl-link">See them on Inventory</Link>.
          </>
        )}
      </p>
      )}
    </section>
  )
}
