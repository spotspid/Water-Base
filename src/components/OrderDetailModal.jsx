import { useCallback, useEffect, useState } from 'react'
import { fetchOrderLines } from '../lib/orders'
import {
  entryState, isOpenOrder, landedUplift, orderStatusLabel, orderStatusTone,
} from '../lib/orderState'
import { formatCurrency } from '../lib/inventory'
import { formatLongDate } from '../lib/schedule'
import Modal from './Modal'
import OrderLineForm from './OrderLineForm'
import OrderLineRow from './OrderLineRow'

// One order, its lines, and receiving.
//
// The entry balance sits at the top rather than the bottom, because the moment
// it matters is while you are still typing lines off a paper invoice, and a
// figure you have to scroll to is a figure nobody checks.
export default function OrderDetailModal({ order, items, onClose, onChanged }) {
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await fetchOrderLines(order.id)
    setError(err || '')
    setLines(err ? [] : (data || []))
    setLoading(false)
  }, [order.id])

  useEffect(() => { load() }, [load])

  function refresh() {
    load()
    onChanged()
  }

  const uplift = landedUplift(order)
  const entry = entryState(order)
  const open = isOpenOrder(order)

  const subtitle = [
    order.order_number,
    formatLongDate(String(order.order_date).slice(0, 10)),
    order.expected_arrival
      ? `expected ${formatLongDate(String(order.expected_arrival).slice(0, 10))}`
      : 'no expected arrival',
  ].filter(Boolean).join(', ')

  return (
    <Modal title={order.supplier} subtitle={subtitle} onClose={onClose} wide>
      <div className="inv-summary ord-figures">
        <div className="inv-stat">
          <span className="inv-stat-label">Lines</span>
          <span className="inv-stat-value">{order.subtotal > 0 ? formatCurrency(order.subtotal) : '$0.00'}</span>
        </div>
        <div className="inv-stat">
          <span className="inv-stat-label">Freight and tax</span>
          <span className="inv-stat-value">
            {formatCurrency(Number(order.freight_amount) + Number(order.tax_amount))}
            {uplift ? <span className="ord-uplift">{uplift.toFixed(2)}%</span> : null}
          </span>
        </div>
        <div className="inv-stat">
          <span className="inv-stat-label">Order total</span>
          <span className="inv-stat-value">{formatCurrency(order.order_total)}</span>
        </div>
        <div className="inv-stat">
          <span className="inv-stat-label">Status</span>
          <span className="inv-stat-value ord-status-cell">
            <span className={`agr-badge agr-${orderStatusTone(order)}`}>{orderStatusLabel(order)}</span>
          </span>
        </div>
      </div>

      {entry.known && (
        <p className={entry.balanced ? 'ord-balance ord-balance-ok' : 'ord-balance'}>
          {entry.balanced
            ? `The lines add up to the invoice total of ${formatCurrency(order.invoice_total)}.`
            : entry.remaining > 0
              ? `${formatCurrency(entry.remaining)} of the ${formatCurrency(order.invoice_total)} invoice is not on a line yet.`
              : `The lines are ${formatCurrency(Math.abs(entry.remaining))} over the invoice total of ${formatCurrency(order.invoice_total)}. Something is typed twice or typed wrong.`}
        </p>
      )}

      {order.notes && <p className="inv-ledger-note">{order.notes}</p>}

      {notice && <p className="set-notice" role="status">{notice}</p>}

      {loading && <p className="inv-state">Loading lines...</p>}

      {!loading && error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
          <button type="button" className="btn-cancel" onClick={load}>Try again</button>
        </div>
      )}

      {!loading && !error && lines.length === 0 && (
        <p className="inv-state">
          No lines yet. Add them from the invoice below, and the balance above will
          reach zero when they are all in.
        </p>
      )}

      {!loading && !error && lines.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Part</th>
                <th className="col-num">Ordered</th>
                <th className="col-num">Received</th>
                <th className="col-num">Outstanding</th>
                <th className="col-num">Invoiced</th>
                <th className="col-num">Landed</th>
                <th>Delivery</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(line => (
                <OrderLineRow key={line.id} line={line}
                  onChanged={refresh} onNotice={setNotice} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <OrderLineForm orderId={order.id} items={items} uplift={uplift}
          onAdded={refresh} disabled={loading} />
      )}

      <p className="inv-ledger-note">
        Landed cost is the invoice price plus this order&apos;s share of freight and tax,
        spread across the lines by what each one cost. Receiving writes a purchase into
        the ledger at that figure, so stock on hand is still summed from the ledger and
        nothing here sets a stock level directly.
      </p>
    </Modal>
  )
}
