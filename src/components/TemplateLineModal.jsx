import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PICK_SOURCES } from '../lib/constants'
import { useSettings, withCurrent } from '../lib/settings'
import { attempt } from '../lib/errors'
import { formatCurrency } from '../lib/inventory'
import { pickCandidates, pickSourceMeta } from '../lib/templates'
import Modal from './Modal'

function initialForm(line) {
  return {
    line_type: line?.line_type || 'fixed',
    item_id: line?.item_id || '',
    pick_source: line?.pick_source || PICK_SOURCES[0]?.value || '',
    pick_category: line?.pick_category || PICK_SOURCES[0]?.defaultCategory || '',
    quantity: line?.quantity == null ? '1' : String(line.quantity),
    sort_order: line?.sort_order == null ? '' : String(line.sort_order),
    note: line?.note || '',
  }
}

export default function TemplateLineModal({
  template, line, items, existingLines, onClose, onSaved,
}) {
  const { categories } = useSettings()
  const editing = Boolean(line?.id)
  const [form, setForm] = useState(() => initialForm(line))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const activeItems = useMemo(
    () => items.filter(i => i.active !== false || i.id === form.item_id),
    [items, form.item_id],
  )

  const selectedItem = useMemo(
    () => items.find(i => i.id === form.item_id) || null,
    [items, form.item_id],
  )

  const candidates = useMemo(
    () => pickCandidates(items, form.pick_category),
    [items, form.pick_category],
  )

  const quantity = Number(form.quantity)
  const validQuantity = Number.isInteger(quantity) && quantity > 0

  function handleChange(e) {
    const { name, value } = e.target
    if (name === 'pick_source') {
      const meta = pickSourceMeta(value)
      setForm(f => ({
        ...f,
        pick_source: value,
        pick_category: meta?.defaultCategory || f.pick_category,
      }))
      return
    }
    setForm(f => ({ ...f, [name]: value }))
  }

  function setLineType(next) {
    setError('')
    setForm(f => ({ ...f, line_type: next }))
  }

  function validate() {
    if (!validQuantity) return 'Quantity must be a whole number greater than zero.'

    if (form.sort_order !== '' && !Number.isInteger(Number(form.sort_order))) {
      return 'Sort order must be a whole number.'
    }

    if (form.line_type === 'fixed') {
      if (!form.item_id) return 'Pick an inventory item for this part.'
      const clash = existingLines.find(
        l => l.line_type === 'fixed' && l.item_id === form.item_id && l.id !== line?.id,
      )
      if (clash) {
        return 'This template already lists that item. Change the quantity on the existing line instead.'
      }
      return ''
    }

    if (!form.pick_source) return 'Pick which customer choice drives this line.'
    if (!form.pick_category) return 'Pick which inventory category the options come from.'

    const clash = existingLines.find(
      l => l.line_type === 'customer_pick' && l.pick_source === form.pick_source && l.id !== line?.id,
    )
    if (clash) {
      return 'This template already has a line for that customer choice.'
    }

    if (candidates.length === 0) {
      return `No active ${form.pick_category} item has a variant, so this line could never resolve. Add items with variants first.`
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

    const isPick = form.line_type === 'customer_pick'
    const payload = {
      template_id: template.id,
      line_type: form.line_type,
      item_id: isPick ? null : form.item_id,
      pick_source: isPick ? form.pick_source : null,
      pick_category: isPick ? form.pick_category : null,
      quantity,
      sort_order: form.sort_order === '' ? 0 : Number(form.sort_order),
      note: form.note.trim() || null,
    }

    const { error: err } = await attempt(
      () => (editing
        ? supabase.from('template_lines').update(payload).eq('id', line.id)
        : supabase.from('template_lines').insert(payload)),
      'That part could not be saved.',
    )

    if (err) {
      setError(err)
      setSaving(false)
      return
    }

    onSaved(editing ? 'Part updated.' : 'Part added to the template.')
  }

  const sourceMeta = pickSourceMeta(form.pick_source)

  return (
    <Modal
      title={editing ? 'Edit Part' : 'Add Part'}
      subtitle={template.label}
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={handleSubmit} noValidate>
        <div className="field field-full">
          <label>Line Type</label>
          <div className="direction-toggle" role="group" aria-label="Line type">
            <button type="button" disabled={saving}
              className={form.line_type === 'fixed' ? 'dir-btn dir-in active' : 'dir-btn dir-in'}
              onClick={() => setLineType('fixed')}>
              Fixed item
            </button>
            <button type="button" disabled={saving}
              className={form.line_type === 'customer_pick' ? 'dir-btn dir-out active' : 'dir-btn dir-out'}
              onClick={() => setLineType('customer_pick')}>
              Customer pick
            </button>
          </div>
          <span className="field-hint">
            {form.line_type === 'fixed'
              ? 'Always the same item on every job using this template.'
              : 'Resolved from the job when it installs, not fixed here.'}
          </span>
        </div>

        <div className="form-grid">
          {form.line_type === 'fixed' && (
            <div className="field field-full">
              <label htmlFor="item_id">Inventory Item</label>
              <select id="item_id" name="item_id" value={form.item_id}
                onChange={handleChange} disabled={saving}>
                <option value="">Select item...</option>
                {activeItems.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.sku} : {i.name}{i.variant ? ` (${i.variant})` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {form.line_type === 'customer_pick' && (
            <>
              <div className="field">
                <label htmlFor="pick_source">Customer Choice</label>
                <select id="pick_source" name="pick_source" value={form.pick_source}
                  onChange={handleChange} disabled={saving}>
                  {PICK_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                {sourceMeta && <span className="field-hint">{sourceMeta.help}</span>}
              </div>

              <div className="field">
                <label htmlFor="pick_category">Item Category</label>
                <select id="pick_category" name="pick_category" value={form.pick_category}
                  onChange={handleChange} disabled={saving}>
                  <option value="">Select category...</option>
                  {withCurrent(categories, form.pick_category).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="quantity">Quantity</label>
            <input id="quantity" name="quantity" type="number" min="1" step="1"
              value={form.quantity} onChange={handleChange} disabled={saving} />
          </div>

          <div className="field">
            <label htmlFor="sort_order">Sort Order</label>
            <input id="sort_order" name="sort_order" type="number" step="10"
              value={form.sort_order} onChange={handleChange} disabled={saving} />
          </div>

          <div className="field field-full">
            <label htmlFor="note">Note <span className="optional">(optional)</span></label>
            <input id="note" name="note" type="text" value={form.note}
              onChange={handleChange} disabled={saving} />
          </div>
        </div>

        {form.line_type === 'fixed' && selectedItem && validQuantity && (
          <div className="txn-effect txn-effect-out">
            <span className="txn-effect-verb">Deducts</span>
            <span className="txn-effect-qty">{quantity}</span>
            <span className="txn-effect-detail">
              {selectedItem.sku} per install, {formatCurrency(quantity * Number(selectedItem.unit_cost || 0))} of parts cost
            </span>
          </div>
        )}

        {form.line_type === 'customer_pick' && (
          <div className="tpl-resolve">
            <p className="tpl-resolve-title">
              Resolves to one of these {candidates.length} {candidates.length === 1 ? 'item' : 'items'}
            </p>
            {candidates.length === 0 ? (
              <p className="tpl-resolve-empty">
                Nothing in {form.pick_category || 'that category'} has a variant to match on.
              </p>
            ) : (
              <ul className="tpl-resolve-list">
                {candidates.map(c => (
                  <li key={c.id}>
                    <span className="tpl-resolve-variant">{c.variant}</span>
                    <span className="tpl-resolve-sku">{c.sku}</span>
                    <span className="tpl-resolve-cost">
                      {formatCurrency(quantity > 0 ? quantity * Number(c.unit_cost || 0) : 0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : editing ? 'Save Part' : 'Add Part'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
