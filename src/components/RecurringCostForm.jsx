import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt, attemptRows } from '../lib/errors'
import { recurringProblem } from '../lib/recurring'
import Modal from './Modal'

// Describes one standing monthly cost: who bills, what for, how much and when.
//
// "The amount varies" is the whole point of the form. A subscription knows its
// own price and can post itself; ad spend does not, and ticking the box is how
// somebody says so. A varying cost then has no amount at all rather than a
// stale one, so nothing can post last month's figure by accident.
//
// Switching a cost off keeps its history. The posted expenses stay in the
// books, which is what the P&L for those months depends on.
export default function RecurringCostForm({ cost, categories, onClose, onSaved }) {
  const editing = Boolean(cost)

  const [form, setForm] = useState({
    vendor: cost?.vendor || '',
    category: cost?.category || '',
    amount: cost?.amount != null ? String(cost.amount) : '',
    amount_varies: Boolean(cost?.amount_varies),
    day_of_month: String(cost?.day_of_month ?? 1),
    note: cost?.note || '',
    active: cost?.active !== false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function change(e) {
    const { name, value, type, checked } = e.target
    setForm(f => {
      const next = { ...f, [name]: type === 'checkbox' ? checked : value }
      // A varying cost holds no amount, so clearing it here means the box
      // never shows a figure that will not be stored.
      if (name === 'amount_varies' && checked) next.amount = ''
      return next
    })
  }

  async function submit(e) {
    e.preventDefault()
    const problem = recurringProblem(form)
    if (problem) { setError(problem); return }

    setSaving(true)
    const row = {
      vendor: form.vendor.trim(),
      category: form.category,
      amount_varies: form.amount_varies,
      amount: form.amount_varies ? null : Number(form.amount.replace(/[$,\s]/g, '')),
      day_of_month: Number(form.day_of_month),
      note: form.note.trim() || null,
      active: form.active,
    }

    const { error: failed } = editing
      ? await attemptRows(() => supabase.from('expense_recurring').update(row).eq('id', cost.id),
        'The standing cost could not be saved.')
      : await attempt(() => supabase.from('expense_recurring').insert(row).select('id').single(),
        'The standing cost could not be added.')

    setSaving(false)
    if (failed) setError(failed)
    else onSaved()
  }

  return (
    <Modal title={editing ? 'Edit a standing cost' : 'Add a standing cost'} onClose={onClose}>
      <form className="modal-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="rc_vendor">Paid to</label>
          <input id="rc_vendor" name="vendor" type="text" value={form.vendor}
            placeholder="Meta, Google Ads, Supabase, DocuSeal..."
            onChange={change} disabled={saving} />
        </div>

        <div className="field">
          <label htmlFor="rc_category">Category</label>
          <select id="rc_category" name="category" value={form.category}
            onChange={change} disabled={saving}>
            <option value="">Pick a category</option>
            {(categories || []).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <label className="rec-varies">
          <input type="checkbox" name="amount_varies" checked={form.amount_varies}
            onChange={change} disabled={saving} />
          {' '}The amount varies each month
        </label>

        {form.amount_varies ? (
          <p className="field-hint">
            It will be listed every month waiting for the real figure, and will
            never post on its own. Read the amount off the platform and enter it.
          </p>
        ) : (
          <div className="field">
            <label htmlFor="rc_amount">Monthly amount ($)</label>
            <input id="rc_amount" name="amount" type="text" inputMode="decimal"
              value={form.amount} placeholder="49.00" onChange={change} disabled={saving} />
            <span className="field-hint">Posts on its own once you press Post.</span>
          </div>
        )}

        <div className="field">
          <label htmlFor="rc_day">Billing day</label>
          <input id="rc_day" name="day_of_month" type="number" min="1" max="28" step="1"
            value={form.day_of_month} onChange={change} disabled={saving} />
          <span className="field-hint">
            1 to 28. Anything billed later in the month goes on 28, so it never
            skips February.
          </span>
        </div>

        <div className="field">
          <label htmlFor="rc_note">Description (optional)</label>
          <input id="rc_note" name="note" type="text" value={form.note}
            placeholder="What the posted expense should say"
            onChange={change} disabled={saving} />
        </div>

        {editing && (
          <label className="rec-varies">
            <input type="checkbox" name="active" checked={form.active}
              onChange={change} disabled={saving} />
            {' '}Still being billed
          </label>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
