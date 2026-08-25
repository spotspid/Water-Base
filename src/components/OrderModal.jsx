import { useState } from 'react'
import { saveOrder } from '../lib/orders'
import Modal from './Modal'

// The order header. Freight and tax go here and nowhere else, because they are
// facts about the shipment rather than about any one part, and typing a landed
// price per line is how a freight charge ends up counted twice or not at all.
//
// The invoice total is optional and is never used in a calculation. It is here
// so the order can tell you when the lines you have typed add up to the
// document in front of you, which is the only check that catches a missing
// line.
const EMPTY = {
  supplier: '',
  order_number: '',
  order_date: '',
  expected_arrival: '',
  freight_amount: '',
  tax_amount: '',
  invoice_total: '',
  notes: '',
}

function money(value) {
  if (value === '' || value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export default function OrderModal({ order, onClose, onSaved }) {
  const [form, setForm] = useState(() => (order
    ? {
      supplier: order.supplier || '',
      order_number: order.order_number || '',
      order_date: String(order.order_date || '').slice(0, 10),
      expected_arrival: String(order.expected_arrival || '').slice(0, 10),
      freight_amount: order.freight_amount == null ? '' : String(order.freight_amount),
      tax_amount: order.tax_amount == null ? '' : String(order.tax_amount),
      invoice_total: order.invoice_total == null ? '' : String(order.invoice_total),
      notes: order.notes || '',
    }
    : EMPTY))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function change(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  function validate() {
    if (!form.supplier.trim()) return 'Who is it from?'
    if (!form.order_date) return 'When was it ordered?'

    for (const [field, label] of [
      ['freight_amount', 'Freight'], ['tax_amount', 'Tax'], ['invoice_total', 'Invoice total'],
    ]) {
      if (form[field] === '') continue
      const n = Number(form[field])
      if (!Number.isFinite(n) || n < 0) return `${label} must be zero or greater, or left blank.`
    }

    if (form.expected_arrival && form.expected_arrival < form.order_date) {
      return 'The expected arrival is before the order date.'
    }

    return ''
  }

  async function submit(e) {
    e.preventDefault()

    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }

    setError('')
    setSaving(true)

    const { error: err } = await saveOrder({
      supplier: form.supplier.trim(),
      order_number: form.order_number.trim() || null,
      order_date: form.order_date,
      expected_arrival: form.expected_arrival || null,
      freight_amount: money(form.freight_amount) ?? 0,
      tax_amount: money(form.tax_amount) ?? 0,
      invoice_total: money(form.invoice_total),
      notes: form.notes.trim() || null,
    }, order?.id)

    setSaving(false)

    if (err) {
      setError(err)
      return
    }

    onSaved()
  }

  return (
    <Modal
      title={order ? 'Edit order' : 'New supplier order'}
      subtitle={order ? `${order.supplier}${order.order_number ? `, ${order.order_number}` : ''}` : undefined}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="supplier">Supplier</label>
            <input id="supplier" name="supplier" type="text" required
              value={form.supplier} onChange={change} disabled={saving} />
          </div>
          <div className="field">
            <label htmlFor="order_number">
              Invoice or order number <span className="optional">(optional)</span>
            </label>
            <input id="order_number" name="order_number" type="text"
              value={form.order_number} onChange={change} disabled={saving} />
          </div>
          <div className="field">
            <label htmlFor="order_date">Order date</label>
            <input id="order_date" name="order_date" type="date" required
              value={form.order_date} onChange={change} disabled={saving} />
          </div>
          <div className="field">
            <label htmlFor="expected_arrival">
              Expected arrival <span className="optional">(optional)</span>
            </label>
            <input id="expected_arrival" name="expected_arrival" type="date"
              value={form.expected_arrival} onChange={change} disabled={saving} />
            <span className="field-hint">
              This is the date a shortage reads against. Leave it blank rather than guessing.
            </span>
          </div>
          <div className="field">
            <label htmlFor="freight_amount">Freight ($)</label>
            <input id="freight_amount" name="freight_amount" type="number" min="0" step="0.01"
              value={form.freight_amount} onChange={change} disabled={saving} />
            <span className="field-hint">Spread across the lines by what they cost.</span>
          </div>
          <div className="field">
            <label htmlFor="tax_amount">Tax ($)</label>
            <input id="tax_amount" name="tax_amount" type="number" min="0" step="0.01"
              value={form.tax_amount} onChange={change} disabled={saving} />
          </div>
          <div className="field field-full">
            <label htmlFor="invoice_total">
              Invoice total ($) <span className="optional">(optional)</span>
            </label>
            <input id="invoice_total" name="invoice_total" type="number" min="0" step="0.01"
              value={form.invoice_total} onChange={change} disabled={saving} />
            <span className="field-hint">
              The figure at the bottom of the invoice. Nothing is calculated from it. It is
              here so the order can tell you when the lines add up.
            </span>
          </div>
          <div className="field field-full">
            <label htmlFor="notes">Notes <span className="optional">(optional)</span></label>
            <textarea id="notes" name="notes" rows="2"
              value={form.notes} onChange={change} disabled={saving} />
          </div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : order ? 'Save order' : 'Create order'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
