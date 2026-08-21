import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { parseAmount, todayIso } from '../lib/expenses'
import Modal from './Modal'

// Adds a manual expense, or edits one that already exists. An imported row can
// be edited here too, which is how a batch gets recategorised without being
// reversed. Its source and batch are never changed, so the trail back to the
// import survives the edit.
export default function ExpenseModal({ expense, categories, onClose, onSaved }) {
  const editing = Boolean(expense)

  const [form, setForm] = useState({
    spent_on: expense?.spent_on || todayIso(),
    amount: expense ? String(expense.amount) : '',
    vendor: expense?.vendor || '',
    category: expense?.category || '',
    description: expense?.description || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  function validate() {
    if (!form.spent_on) return 'Pick the date it was spent.'
    const amount = parseAmount(form.amount)
    if (amount == null) return 'Enter an amount.'
    if (amount === 0) return 'An expense of zero has nothing to record.'
    if (!form.category) return 'Pick a category.'
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
      spent_on: form.spent_on,
      amount: parseAmount(form.amount),
      vendor: form.vendor.trim() || null,
      category: form.category,
      description: form.description.trim() || null,
    }

    const { error: err } = await attempt(
      () => (editing
        ? supabase.from('expenses').update(payload).eq('id', expense.id)
        : supabase.from('expenses').insert({ ...payload, source: 'manual' })),
      editing ? 'That expense could not be saved.' : 'That expense could not be added.',
    )

    setSaving(false)

    if (err) {
      setError(err)
      return
    }

    onSaved()
  }

  return (
    <Modal
      title={editing ? 'Edit Expense' : 'Add Expense'}
      subtitle={editing && expense.source === 'import'
        ? 'This row came from an import. Editing it keeps it attached to that batch.'
        : undefined}
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="spent_on">Date</label>
            <input id="spent_on" name="spent_on" type="date" value={form.spent_on}
              onChange={handleChange} disabled={saving} />
          </div>

          <div className="field">
            <label htmlFor="amount">Amount ($)</label>
            <input id="amount" name="amount" type="text" inputMode="decimal"
              value={form.amount} onChange={handleChange} disabled={saving}
              placeholder="0.00" autoFocus={!editing} />
            <span className="field-hint">A negative amount records a refund.</span>
          </div>

          <div className="field">
            <label htmlFor="vendor">Vendor <span className="optional">(optional)</span></label>
            <input id="vendor" name="vendor" type="text" value={form.vendor}
              onChange={handleChange} disabled={saving} />
          </div>

          <div className="field">
            <label htmlFor="category">Category</label>
            <select id="category" name="category" value={form.category}
              onChange={handleChange} disabled={saving}>
              <option value="">Select category...</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="field field-full">
            <label htmlFor="description">Description <span className="optional">(optional)</span></label>
            <textarea id="description" name="description" rows="2" value={form.description}
              onChange={handleChange} disabled={saving} />
          </div>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save changes' : 'Add expense'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
