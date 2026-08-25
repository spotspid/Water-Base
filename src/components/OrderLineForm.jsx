import { useState } from 'react'
import { addOrderLine } from '../lib/orders'
import { formatCurrency } from '../lib/inventory'

// Adding one line off the invoice.
//
// Unit cost is the price printed on the line, before freight. The landed
// figure is worked out by the database once freight is spread across every
// line, so it cannot be typed here and cannot drift from the freight amount it
// came from. The preview below shows what this line will cost landed at the
// current rate, which is the number a person actually wants to sanity check.
export default function OrderLineForm({ orderId, items, uplift, onAdded, disabled }) {
  const [form, setForm] = useState({ item_id: '', quantity_ordered: '', unit_cost: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const quantity = Number(form.quantity_ordered)
  const cost = Number(form.unit_cost)
  const valid = Number.isFinite(quantity) && quantity > 0 && Number.isFinite(cost) && cost >= 0

  // The rate is the one the order carries today. Adding this line changes the
  // subtotal and therefore the rate, so this is an estimate and says so.
  const landed = valid && uplift != null ? cost * (1 + uplift / 100) : null

  function change(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  async function submit(e) {
    e.preventDefault()

    if (!form.item_id) {
      setError('Pick a part.')
      return
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Quantity ordered must be at least one.')
      return
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setError('Unit cost must be zero or greater.')
      return
    }

    setError('')
    setBusy(true)

    const { error: err } = await addOrderLine({
      order_id: orderId,
      item_id: form.item_id,
      quantity_ordered: Math.round(quantity),
      unit_cost: cost,
    })

    setBusy(false)

    if (err) {
      setError(err)
      return
    }

    setForm({ item_id: '', quantity_ordered: '', unit_cost: '' })
    onAdded()
  }

  return (
    <form className="ord-line-form" onSubmit={submit} noValidate>
      <div className="field ord-line-part">
        <label htmlFor="line-item">Part</label>
        <select id="line-item" name="item_id" value={form.item_id}
          onChange={change} disabled={disabled || busy}>
          <option value="">Select a part...</option>
          {items.map(item => (
            <option key={item.id} value={item.id}>
              {item.name}{item.variant ? `, ${item.variant}` : ''} ({item.sku})
            </option>
          ))}
        </select>
      </div>
      <div className="field ord-line-qty">
        <label htmlFor="line-qty">Quantity</label>
        <input id="line-qty" name="quantity_ordered" type="number" min="1" step="1"
          value={form.quantity_ordered} onChange={change} disabled={disabled || busy} />
      </div>
      <div className="field ord-line-cost">
        <label htmlFor="line-cost">Unit cost ($)</label>
        <input id="line-cost" name="unit_cost" type="number" min="0" step="0.01"
          value={form.unit_cost} onChange={change} disabled={disabled || busy} />
      </div>
      <button type="submit" className="btn-cancel" disabled={disabled || busy}>
        {busy ? 'Adding...' : 'Add line'}
      </button>

      {landed != null && (
        <p className="ord-line-preview">
          Lands around {formatCurrency(landed)} each once freight is spread, so
          {' '}{formatCurrency(landed * quantity)} for {quantity}. The exact figure settles
          when every line is in.
        </p>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  )
}
