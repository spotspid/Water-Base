import { Link } from 'react-router-dom'
import { formatLongDate } from '../lib/schedule'
import { arrivalState } from '../lib/orderState'

// Parts a booked job needs and cannot get.
//
// This used to be a full stock table showing every part with nothing free to
// sell, which meant 14 SKUs from an unreceived supplier order filled the top
// of the dashboard while not one of them blocked a job. A part at zero with
// nothing committed against it is not a shortage, it is something the business
// does not stock, and putting it here taught everyone to scroll past the panel.
//
// So the table is gone and what is left is the exception: something is
// promised to a booked job that the shelf cannot cover. That is rare, it is
// always worth reading, and when there is none of it this says so in one line
// and takes up no more room than that.
//
// The full picture still exists on Inventory, which is where you go to think
// about stock rather than to be interrupted by it.
export default function DashboardShortages({ rows, itemCount }) {
  if (itemCount === 0) return null

  if (rows.length === 0) {
    return (
      <p className="dash-oneline">
        <span className="pill pill-green"><span className="pill-dot" />Parts clear</span>
        Nothing booked is short. Every part a scheduled job needs is on the shelf.
        {' '}
        <Link to="/inventory" className="tpl-link">Inventory</Link>
      </p>
    )
  }

  return (
    <section className="dash-panel dash-panel-alarm">
      <header className="dash-panel-head">
        <h2>Short for booked work</h2>
        <span className="dash-panel-note">
          Promised to a booked job beyond what the shelf holds
        </span>
        <Link to="/inventory" className="tpl-link">Inventory</Link>
      </header>

      <ul className="dash-short-list">
        {rows.map(row => {
          const arrival = arrivalState(row)
          const short = Math.abs(Number(row.free) || 0)

          return (
            <li key={row.id} className="dash-short-row">
              <span className="dash-short-part">
                {row.name}
                {row.variant && <span className="cell-sub">{row.variant}</span>}
              </span>
              <span className="dash-short-count">
                <b>{short}</b> short
              </span>
              <span className="dash-short-arrival">
                {arrival.state === 'none' && <span className="cell-unset">nothing on order</span>}
                {arrival.state === 'overdue' && (
                  <span className="dash-due">
                    {arrival.onOrder} on order, due {formatLongDate(arrival.date)}
                  </span>
                )}
                {arrival.state === 'coming' && (
                  <>{arrival.onOrder} on order
                    {arrival.date ? `, ${formatLongDate(arrival.date)}` : ', no date'}
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
