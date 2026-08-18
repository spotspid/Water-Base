import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import { effectiveDirection, signedQuantity, txnTypeMeta } from '../lib/inventory'
import Modal from './Modal'

export default function LogTransactionModal({ items, presetItemId, onClose, onSaved }) {
  const { txnTypes, defaultLocation, loading: loadingSettings } = useSettings()
  const [form, setForm] = useState({
    item_id: presetItemId || '',
    txn_type: '',
    quantity: '1',
    adjust_direction: 'add',
    reference: '',
    note: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const selected = useMemo(
    () => items.find(i => i.id === form.item_id) || null,
    [items, form.item_id],
  )

  // types are operator editable, so the default is whichever comes first
  // rather than a value baked into this component
  useEffect(() => {
    if (txnTypes.length === 0) return
    setForm(f => (f.txn_type ? f : { ...f, txn_type: txnTypes[0].value }))
  }, [txnTypes])

  const meta = txnTypeMeta(txnTypes, form.txn_type)
  const direction = effectiveDirection(txnTypes, form.txn_type, form.adjust_direction)
  const signed = signedQuantity(txnTypes, form.txn_type, form.quantity, form.adjust_direction)
  const projected = selected ? Number(selected.on_hand) + signed : null
  const goesNegative = projected !== null && projected < 0

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  function validate() {
    if (!form.item_id) return 'Pick an item.'
    if (!form.txn_type) return 'Pick a transaction type.'
    if (!meta) return 'That transaction type is no longer available. Pick another.'
    const size = Number(form.quantity)
    if (!Number.isFinite(size) || size <= 0) return 'Quantity must be greater than zero.'
    if (!Number.isInteger(size)) return 'Quantity must be a whole number.'
    if (signed === 0) return 'This transaction would not change stock.'
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }

    setError('')
    setSaving(true)

    const payload = {
      item_id: form.item_id,
      quantity: signed,
      txn_type: form.txn_type,
      unit_cost_at_txn: selected ? Number(selected.unit_cost) : null,
      location: defaultLocation || null,
      reference: form.reference.trim() || null,
      note: form.note.trim() || null,
    }

    try {
      const { error: err } = await supabase.from('inventory_transactions').insert(payload)
      if (err) {
        setError(err.message)
        setSaving(false)
        return
      }
      onSaved()
    } catch (caught) {
      setError(caught?.message || 'Could not reach the database. Check your connection and try again.')
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Log Transaction"
      subtitle="Every stock change is a new ledger entry. Nothing is overwritten."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="field field-full">
            <label htmlFor="item_id">Item</label>
            <select id="item_id" name="item_id" value={form.item_id}
              onChange={handleChange} disabled={saving}>
              <option value="">Select item...</option>
              {items.map(i => (
                <option key={i.id} value={i.id}>
                  {i.sku} : {i.name}{i.variant ? ` (${i.variant})` : ''} : {i.on_hand} on hand
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="txn_type">Type</label>
            <select id="txn_type" name="txn_type" value={form.txn_type}
              onChange={handleChange} disabled={saving || loadingSettings}>
              <option value="">
                {loadingSettings ? 'Loading types...' : 'Select type...'}
              </option>
              {txnTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {meta && <span className="field-hint">{meta.help}</span>}
          </div>

          <div className="field">
            <label htmlFor="quantity">Quantity</label>
            <input id="quantity" name="quantity" type="number" min="1" step="1"
              value={form.quantity} onChange={handleChange} disabled={saving} />
            <span className="field-hint">Always a positive count. Direction is set by type.</span>
          </div>

          {meta && meta.direction === 0 && (
            <div className="field field-full">
              <label>Direction</label>
              <div className="direction-toggle" role="group" aria-label="Adjustment direction">
                <button type="button" disabled={saving}
                  className={form.adjust_direction === 'add' ? 'dir-btn dir-in active' : 'dir-btn dir-in'}
                  onClick={() => setForm(f => ({ ...f, adjust_direction: 'add' }))}>
                  Add to stock
                </button>
                <button type="button" disabled={saving}
                  className={form.adjust_direction === 'remove' ? 'dir-btn dir-out active' : 'dir-btn dir-out'}
                  onClick={() => setForm(f => ({ ...f, adjust_direction: 'remove' }))}>
                  Remove from stock
                </button>
              </div>
            </div>
          )}

          <div className="field">
            <label htmlFor="location">Location</label>
            <input id="location" type="text" value={defaultLocation || 'Not set'} disabled readOnly />
            <span className="field-hint">Set on the Settings page.</span>
          </div>

          <div className="field">
            <label htmlFor="reference">Reference <span className="optional">(optional)</span></label>
            <input id="reference" name="reference" type="text" value={form.reference}
              onChange={handleChange} disabled={saving} placeholder="PO number, invoice, job" />
          </div>

          <div className="field">
            <label htmlFor="note">Note <span className="optional">(optional)</span></label>
            <input id="note" name="note" type="text" value={form.note}
              onChange={handleChange} disabled={saving} />
          </div>
        </div>

        <div className={direction < 0 ? 'txn-effect txn-effect-out' : 'txn-effect txn-effect-in'}>
          <span className="txn-effect-verb">{direction < 0 ? 'Removes' : 'Adds'}</span>
          <span className="txn-effect-qty">{Math.abs(signed)}</span>
          {selected
            ? <span className="txn-effect-detail">
                {selected.sku} on hand {selected.on_hand} goes to <strong>{projected}</strong>
              </span>
            : <span className="txn-effect-detail">Pick an item to preview the new count.</span>}
        </div>

        {goesNegative && (
          <p className="form-warning" role="status">
            This would put on hand below zero. Check the count before saving.
          </p>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Log Transaction'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
