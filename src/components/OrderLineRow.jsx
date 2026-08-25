import { useState } from 'react'
import { receiveLine, removeOrderLine } from '../lib/orders'
import { formatCurrency } from '../lib/inventory'

// One line, and the two things that can happen to it: some of it turns up, or
// it was typed wrong and goes away.
//
// Receiving defaults to the whole outstanding quantity, because that is what
// usually arrives, but the box is editable because partial is the case this
// was built for. Two of four now and two next week is two ledger entries on
// two dates, which is what actually happened.
export default function OrderLineRow({ line, onChanged, onNotice }) {
  const [receiving, setReceiving] = useState(false)
  const [quantity, setQuantity] = useState(String(line.quantity_outstanding))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)

  const outstanding = Number(line.quantity_outstanding) || 0
  const received = Number(line.quantity_received) || 0
  const closed = outstanding === 0
  const cancelled = line.order_status === 'cancelled'

  async function receive() {
    const n = Number(quantity)

    if (!Number.isFinite(n) || n <= 0) {
      setError('Receive at least one.')
      return
    }
    if (n > outstanding) {
      setError(`Only ${outstanding} still outstanding on this line.`)
      return
    }

    setError('')
    setBusy(true)

    const { data, error: err } = await receiveLine(line.id, Math.round(n))

    setBusy(false)

    if (err) {
      setError(err)
      return
    }

    setReceiving(false)
    onNotice(`${data?.quantity} x ${data?.sku} received at ${formatCurrency(data?.landed_unit_cost)} landed, `
      + `${formatCurrency(data?.landed_value)} into stock.`)
    onChanged()
  }

  async function remove() {
    setError('')
    setBusy(true)

    const { error: err } = await removeOrderLine(line.id)

    setBusy(false)

    if (err) {
      setError(err)
      return
    }

    setConfirmRemove(false)
    onChanged()
  }

  return (
    <>
      <tr className={closed ? 'ord-line-done' : undefined}>
        <td className="td-customer">
          {line.item_name}
          <span className="cell-sub">
            {[line.sku, line.variant].filter(Boolean).join(', ')}
          </span>
        </td>
        <td className="col-num">{line.quantity_ordered}</td>
        <td className="col-num">
          {received}
          {received > 0 && outstanding > 0 && <span className="cell-sub">part</span>}
        </td>
        <td className="col-num">{outstanding}</td>
        <td className="col-num">{formatCurrency(line.unit_cost)}</td>
        <td className="col-num col-value">
          {formatCurrency(line.landed_unit_cost)}
          <span className="cell-sub">+{formatCurrency(line.allocated_extra)} freight</span>
        </td>
        <td className="col-nowrap">
          {closed
            ? <span className="pill pill-green">Complete</span>
            : cancelled
              ? <span className="pill">Cancelled</span>
              : (
                <button type="button" className="btn-cancel ord-mini"
                  disabled={busy} onClick={() => { setReceiving(v => !v); setError('') }}>
                  Receive
                </button>
              )}
        </td>
      </tr>

      {receiving && !closed && !cancelled && (
        <tr className="ord-line-action">
          <td colSpan={7}>
            <div className="ord-receive">
              <label htmlFor={`recv-${line.id}`}>How many arrived?</label>
              <input id={`recv-${line.id}`} type="number" min="1" max={outstanding} step="1"
                value={quantity} disabled={busy}
                onChange={e => { setQuantity(e.target.value); setError('') }} />
              <span className="ord-receive-note">
                of {outstanding} outstanding, at {formatCurrency(line.landed_unit_cost)} landed
              </span>
              <button type="button" className="btn-primary ord-mini" disabled={busy} onClick={receive}>
                {busy ? 'Recording...' : 'Record delivery'}
              </button>
              <button type="button" className="btn-cancel ord-mini" disabled={busy}
                onClick={() => { setReceiving(false); setError('') }}>
                Cancel
              </button>
            </div>
            {received === 0 && !confirmRemove && (
              <button type="button" className="ord-remove" disabled={busy}
                onClick={() => setConfirmRemove(true)}>
                Remove this line
              </button>
            )}
            {confirmRemove && (
              <div className="ord-receive">
                <span className="agr-confirm-text">
                  Remove {line.sku} from this order? Nothing has been received against it.
                </span>
                <button type="button" className="btn-primary ord-mini" disabled={busy} onClick={remove}>
                  Yes, remove it
                </button>
                <button type="button" className="btn-cancel ord-mini" disabled={busy}
                  onClick={() => setConfirmRemove(false)}>
                  Keep it
                </button>
              </div>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
          </td>
        </tr>
      )}
    </>
  )
}
