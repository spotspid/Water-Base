import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import Modal from './Modal'

function initialForm(template) {
  return {
    label: template?.label || '',
    default_price: template?.default_price == null ? '' : String(template.default_price),
    sort_order: template?.sort_order == null ? '' : String(template.sort_order),
    active: template?.active ?? true,
    notes: template?.notes || '',
  }
}

export default function TemplateFormModal({ template, onClose, onSaved }) {
  const editing = Boolean(template?.id)
  const [form, setForm] = useState(() => initialForm(template))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const renaming = editing && form.label.trim() !== template.label

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  function validate() {
    if (!form.label.trim()) return 'A template needs a name.'
    if (form.label.trim().length > 80) return 'Keep the name under 80 characters.'

    if (form.default_price !== '') {
      const price = Number(form.default_price)
      if (!Number.isFinite(price) || price < 0) return 'Default price must be zero or greater, or left blank.'
    }

    if (form.sort_order !== '') {
      const order = Number(form.sort_order)
      if (!Number.isInteger(order)) return 'Sort order must be a whole number.'
    }

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
      label: form.label.trim(),
      default_price: form.default_price === '' ? null : Number(form.default_price),
      sort_order: form.sort_order === '' ? 0 : Number(form.sort_order),
      active: form.active,
      notes: form.notes.trim() || null,
    }

    const { error: err } = await attempt(
      () => (editing
        ? supabase.from('system_templates').update(payload).eq('id', template.id)
        : supabase.from('system_templates').insert(payload)),
      'The template could not be saved.',
    )

    if (err) {
      setError(err.includes('already exists')
        ? `A template named "${payload.label}" already exists. Pick a different name.`
        : err)
      setSaving(false)
      return
    }

    onSaved(editing ? 'Template updated.' : 'Template created.')
  }

  return (
    <Modal
      title={editing ? 'Edit Template' : 'New Template'}
      subtitle="The parts list is edited on the template card after saving."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="field field-full">
            <label htmlFor="label">Name</label>
            <input id="label" name="label" type="text" value={form.label}
              onChange={handleChange} disabled={saving} autoFocus />
            <span className="field-hint">Shown in the system dropdown on a new job.</span>
          </div>

          <div className="field">
            <label htmlFor="default_price">Default Price ($) <span className="optional">(optional)</span></label>
            <input id="default_price" name="default_price" type="number" min="0" step="0.01"
              value={form.default_price} onChange={handleChange} disabled={saving} />
            <span className="field-hint">Leave blank to price each job by hand.</span>
          </div>

          <div className="field">
            <label htmlFor="sort_order">Sort Order</label>
            <input id="sort_order" name="sort_order" type="number" step="10"
              value={form.sort_order} onChange={handleChange} disabled={saving} />
            <span className="field-hint">Lower numbers appear first.</span>
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

        {renaming && (
          <p className="form-warning" role="status">
            Jobs already saved on this template keep the old name in their history.
            They stay linked by id, so their parts list still resolves.
          </p>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save Template' : 'Create Template'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
