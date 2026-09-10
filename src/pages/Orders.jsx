import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { fetchOrders } from '../lib/orders'
import { isOpenOrder, orderStatusLabel, orderStatusTone } from '../lib/orderState'
import { formatCurrency, sortStockRows } from '../lib/inventory'
import { formatLongDate } from '../lib/schedule'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import OrderDetailModal from '../components/OrderDetailModal'
import OrderModal from '../components/OrderModal'
import './Orders.css'

const ITEM_COLUMNS = 'id, sku, name, category, variant, unit_cost, active'

export default function Orders() {
  // The stock channel links here as /orders?order=<id>, so an arrival message
  // opens the order it is about rather than a list to search through.
  const [params, setParams] = useSearchParams()
  const openOrderId = params.get('order') || ''

  const [orders, setOrders] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // null when no form is open, {} for a new order, or the order being edited.
  const [editing, setEditing] = useState(null)
  const [notice, setNotice] = useState('')

  const openById = useCallback(id => {
    setNotice('')
    setParams(current => {
      const next = new URLSearchParams(current)
      if (id) next.set('order', id)
      else next.delete('order')
      return next
    }, { replace: true })
  }, [setParams])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [orderRes, itemRes] = await Promise.all([
      fetchOrders(),
      attempt(
        () => supabase.from('inventory_items').select(ITEM_COLUMNS).eq('active', true),
        'The parts list could not be loaded.',
      ),
    ])

    const firstError = orderRes.error || itemRes.error

    if (firstError) {
      setError(firstError)
      setOrders([])
      setItems([])
    } else {
      setOrders(orderRes.data || [])
      setItems(sortStockRows(itemRes.data || []))
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openOrder = useMemo(
    () => orders.find(o => o.id === openOrderId) || null,
    [orders, openOrderId],
  )

  const incoming = useMemo(() => orders.filter(isOpenOrder), [orders])

  const totals = useMemo(() => incoming.reduce((acc, o) => ({
    units: acc.units + (Number(o.units_outstanding) || 0),
    value: acc.value + (Number(o.order_total) || 0),
  }), { units: 0, value: 0 }), [incoming])

  const hasData = !loading && !error
  const linkedMissing = hasData && Boolean(openOrderId) && !openOrder

  return (
    <AppShell actions={(
      <button type="button" className="btn-primary" onClick={() => setEditing({})}>
        + New order
      </button>
    )}>
      <div className="ord-page">

        {hasData && orders.length > 0 && (
          <div className="inv-summary">
            <div className="inv-stat inv-stat-lead">
              <span className="inv-stat-label">Still coming</span>
              <span className="inv-stat-value">{totals.units}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Open orders</span>
              <span className="inv-stat-value">{incoming.length}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Value in flight</span>
              <span className="inv-stat-value">{formatCurrency(totals.value)}</span>
            </div>
          </div>
        )}

        {linkedMissing && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">That order is not here any more.</p>
            <p className="inv-error-detail">
              The link pointed at an order that has since been deleted, or one you cannot see.
            </p>
            <button type="button" className="btn-cancel" onClick={() => openById('')}>
              Show all orders
            </button>
          </div>
        )}

        {loading && <p className="inv-state">Loading orders...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">Supplier orders could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && orders.length === 0 && (
          <EmptyState
            title="No supplier orders yet"
            actions={(
              <button type="button" className="btn-primary" onClick={() => setEditing({})}>
                Enter your first order
              </button>
            )}
          >
            <p>
              An order is what turns a shortage into a date. Once a part is on one,
              {' '}<Link to="/inventory" className="tpl-link">inventory</Link> stops saying
              only that there is none free and starts saying when there will be.
            </p>
            <p>
              Freight and tax go on the order, not the line. They are spread across the
              lines by what each one cost, so receiving puts the true landed price into
              the ledger rather than the invoice price with the shipping missing.
            </p>
          </EmptyState>
        )}

        {hasData && orders.length > 0 && (
          <div className="table-wrap">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Ordered</th>
                  <th>Expected</th>
                  <th className="col-num">Lines</th>
                  <th className="col-num">Outstanding</th>
                  <th className="col-num">Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(order => (
                  <tr key={order.id} className="inv-row" tabIndex={0}
                    onClick={() => openById(order.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openById(order.id)
                      }
                    }}>
                    <td className="td-customer">
                      {order.supplier}
                      {order.order_number && <span className="cell-sub">{order.order_number}</span>}
                    </td>
                    <td className="col-nowrap">
                      {formatLongDate(String(order.order_date).slice(0, 10))}
                    </td>
                    <td className="col-nowrap">
                      {order.expected_arrival
                        ? formatLongDate(String(order.expected_arrival).slice(0, 10))
                        : <span className="cell-unset">no date</span>}
                    </td>
                    <td className="col-num">
                      {order.line_count}
                      {order.line_count === 0 && <span className="cell-sub">none yet</span>}
                    </td>
                    <td className="col-num">{order.units_outstanding}</td>
                    <td className="col-num col-value">{formatCurrency(order.order_total)}</td>
                    <td>
                      <span className={`agr-badge agr-${orderStatusTone(order)}`}>
                        {orderStatusLabel(order)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasData && orders.length > 0 && (
          <p className="inv-ledger-note">
            An order counts toward incoming stock while it is ordered or part delivered,
            and stops the moment every line is received. Receiving writes a purchase into
            the ledger at the landed cost, so on hand is still summed from the ledger and
            nothing here edits a stock level.
          </p>
        )}
      </div>

      {editing && (
        <OrderModal
          order={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setNotice(editing.id ? 'Order details saved.' : '')
            setEditing(null)
            load()
          }}
        />
      )}

      {/* The edit form takes the detail modal's place rather than stacking on
          it, so one Escape closes one thing. Saving or cancelling brings the
          detail back, reloaded. */}
      {openOrder && !editing && (
        <OrderDetailModal
          order={openOrder}
          items={items}
          notice={notice}
          onClose={() => openById('')}
          onEdit={() => setEditing(openOrder)}
          onChanged={load}
        />
      )}
    </AppShell>
  )
}
