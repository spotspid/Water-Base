import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import Modal from './Modal'

const EMPTY_FORM = {
  sku: '',
  name: '',
  category: '',
  variant: '',
  unit_cost: '0',
  reorder_threshold: '0',
  active: true,
  notes: '',
}

export default function AddItemModal({ onClose, onSaved }) {
  const { categories, loading: loadingSettings } = useSettings()
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  function validate() {
    if (!form.sku.trim()) return 'SKU is required.'
    if (!form.name.trim()) return 'Name is required.'
    if (!form.category) return 'Category is required.'
    const cost = Number(form.unit_cost)
    if (!Number.isFinite(cost) || cost < 0) return 'Unit cost must be zero or greater.'
    const threshold = Number(form.reorder_threshold)
    if (!Number.isInteger(threshold) || threshold < 0) return 'Reorder threshold must be a whole number, zero or greater.'
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
      sku: form.sku.trim(),
      name: form.name.trim(),
      category: form.category,
      variant: form.variant.trim() || null,
      unit_cost: Number(form.unit_cost),
      reorder_threshold: Number(form.reorder_threshold),
      active: form.active,
      notes: form.notes.trim() || null,
    }

    try {
      const { error: err } = await supabase.from('inventory_items').insert(payload)
      if (err) {
        setError(err.code === '23505'
          ? `SKU "${payload.sku}" already exists. Pick a different SKU.`
          : err.message)
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
    <Modal title="Add item" subtitle="Creates a catalog item. Stock starts at zero." onClose={onClose}>
      <form className="modal-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="sku">SKU</label>
            <input id="sku" name="sku" type="text" value={form.sku}
              onChange={handleChange} disabled={saving} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="category">Category</label>
            <select id="category" name="category" value={form.category}
              onChange={handleChange} disabled={saving || loadingSettings}>
              <option value="">{loadingSettings ? 'Loading categories...' : 'Select category...'}</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field field-full">
            <label htmlFor="name">Name</label>
            <input id="name" name="name" type="text" value={form.name}
              onChange={handleChange} disabled={saving} />
          </div>
          <div className="field">
            <label htmlFor="variant">Variant <span className="optional">(optional)</span></label>
            <input id="variant" name="variant" type="text" value={form.variant}
              onChange={handleChange} disabled={saving} />
          </div>
          <div className="field">
            <label htmlFor="unit_cost">Unit cost ($)</label>
            <input id="unit_cost" name="unit_cost" type="number" min="0" step="0.01"
              value={form.unit_cost} onChange={handleChange} disabled={saving} />
          </div>
          <div className="field">
            <label htmlFor="reorder_threshold">Reorder threshold</label>
            <input id="reorder_threshold" name="reorder_threshold" type="number" min="0" step="1"
              value={form.reorder_threshold} onChange={handleChange} disabled={saving} />
            <span className="field-hint">Flagged as low stock at or below this count.</span>
          </div>
          <div className="field field-checkbox">
            <label htmlFor="active">
              <input id="active" name="active" type="checkbox"
                checked={form.active} onChange={handleChange} disabled={saving} />
              Active
            </label>
          </div>
          <div className="field field-full">
            <label htmlFor="notes">Notes <span className="optional">(optional)</span></label>
            <textarea id="notes" name="notes" rows="2" value={form.notes}
              onChange={handleChange} disabled={saving} />
          </div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Add item'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
