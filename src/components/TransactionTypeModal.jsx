import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { DIRECTION_LABELS } from '../lib/settings'
import Modal from './Modal'

// codes are stored on every ledger row, so they stay lowercase and simple
const CODE_PATTERN = /^[a-z][a-z0-9_]*$/

function initialForm(type) {
  return {
    value: type?.value || '',
    label: type?.label || '',
    direction: type?.direction == null ? '-1' : String(type.direction),
    help: type?.help || '',
    sort_order: type?.sort_order == null ? '' : String(type.sort_order),
  }
}

export default function TransactionTypeModal({ type, existing, onClose, onSaved }) {
  const editing = Boolean(type?.value)
  const isSystem = Boolean(type?.is_system)
  const [form, setForm] = useState(() => initialForm(type))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  function validate() {
    if (!form.label.trim()) return 'A type needs a label.'

    if (form.sort_order !== '' && !Number.isInteger(Number(form.sort_order))) {
      return 'Sort order must be a whole number.'
    }

    if (!editing) {
      const code = form.value.trim()
      if (!code) return 'A type needs a code.'
      if (!CODE_PATTERN.test(code)) {
        return 'The code must start with a letter and use only lowercase letters, numbers and underscores.'
      }
      if (existing.some(t => t.value === code)) {
        return `The code "${code}" is already in use.`
      }
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

    // a built in type only accepts wording changes, which the database
    // enforces too, so the form does not even send the locked fields
    const payload = isSystem
      ? {
          label: form.label.trim(),
          help: form.help.trim() || null,
          sort_order: form.sort_order === '' ? 0 : Number(form.sort_order),
        }
      : {
          label: form.label.trim(),
          direction: Number(form.direction),
          help: form.help.trim() || null,
          sort_order: form.sort_order === '' ? 0 : Number(form.sort_order),
        }

    const { error: err } = await attempt(
      () => (editing
        ? supabase.from('transaction_types').update(payload).eq('value', type.value)
        : supabase.from('transaction_types').insert({ ...payload, value: form.value.trim() })),
      'That transaction type could not be saved.',
    )

    if (err) {
      setError(err)
      setSaving(false)
      return
    }

    onSaved(editing ? `Updated "${payload.label}".` : `Added "${payload.label}".`)
  }

  return (
    <Modal
      title={editing ? 'Edit Transaction Type' : 'New Transaction Type'}
      subtitle={isSystem
        ? 'This type is built in. Its code and direction are fixed because the app writes it automatically.'
        : 'Types appear in the log transaction form and on every ledger row.'}
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="label">Label</label>
            <input id="label" name="label" type="text" value={form.label}
              onChange={handleChange} disabled={saving} autoFocus />
            <span className="field-hint">What people see in the dropdown.</span>
          </div>

          <div className="field">
            <label htmlFor="value">Code</label>
            <input id="value" name="value" type="text" value={form.value}
              onChange={handleChange} disabled={saving || editing}
              placeholder="shrinkage" />
            <span className="field-hint">
              {editing
                ? 'Stored on every existing ledger row, so it cannot change.'
                : 'Lowercase, no spaces. Stored on every ledger row.'}
            </span>
          </div>

          <div className="field field-full">
            <label htmlFor="direction">Direction</label>
            <select id="direction" name="direction" value={form.direction}
              onChange={handleChange} disabled={saving || isSystem}>
              <option value="1">{DIRECTION_LABELS['1']}</option>
              <option value="-1">{DIRECTION_LABELS['-1']}</option>
              <option value="0">{DIRECTION_LABELS['0']}</option>
            </select>
            <span className="field-hint">
              {isSystem
                ? 'Fixed, because the app relies on this type moving stock the way it does.'
                : 'The log form always asks for a positive count and applies this direction.'}
            </span>
          </div>

          <div className="field field-full">
            <label htmlFor="help">Help Text <span className="optional">(optional)</span></label>
            <input id="help" name="help" type="text" value={form.help}
              onChange={handleChange} disabled={saving} />
          </div>

          <div className="field">
            <label htmlFor="sort_order">Sort Order</label>
            <input id="sort_order" name="sort_order" type="number" step="10"
              value={form.sort_order} onChange={handleChange} disabled={saving} />
          </div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save Type' : 'Add Type'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
