import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attemptRows } from '../lib/errors'
import { formatCurrency } from '../lib/inventory'

// The catalogue cost, editable in place.
//
// Receiving a supplier order sets this to what the delivery actually landed
// at, freight included, so the shelf is valued at what was paid rather than at
// a figure somebody typed when the part was first added. That is right almost
// always, and wrong occasionally: a one off price, a sample, a supplier
// correction that arrives after the goods. So it stays a plain field.
//
// Changing it moves what the shelf is worth from here on and nothing else.
// Every ledger row carries the cost stamped on it at the time and job margins
// are summed from those, so no finished job moves because somebody retyped a
// price today.
export default function ItemCostField({ item, onChanged }) {
  const stored = item.unit_cost == null ? '' : String(item.unit_cost)
  const [draft, setDraft] = useState(stored)
  const [saved, setSaved] = useState(stored)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // The row can change underneath this panel when a delivery is received, so
  // follow the new value unless there is unsaved typing in the box.
  useEffect(() => {
    const next = item.unit_cost == null ? '' : String(item.unit_cost)
    if (next === saved) return
    if (draft === saved) setDraft(next)
    setSaved(next)
  }, [item.unit_cost, saved, draft])

  const dirty = draft !== saved
  const onHand = Number(item.on_hand) || 0

  async function save() {
    const value = Number(draft)

    if (draft.trim() === '' || !Number.isFinite(value) || value < 0) {
      setError('Unit cost must be zero or greater.')
      return
    }

    setError('')
    setNotice('')
    setBusy(true)

    const { error: err } = await attemptRows(
      () => supabase.from('inventory_items').update({ unit_cost: value }).eq('id', item.id),
      'The unit cost could not be saved.',
    )

    setBusy(false)

    if (err) {
      setError(err)
      return
    }

    const next = String(value)
    setDraft(next)
    setSaved(next)
    setNotice(onHand > 0
      ? `Saved. ${onHand} on hand now values at ${formatCurrency(value * onHand)}.`
      : 'Saved. Nothing is on hand, so this takes effect when some arrives.')
    onChanged()
  }

  return (
    <section className="inv-cost">
      <div className="inv-cost-row">
        <div className="field inv-cost-field">
          <label htmlFor={`cost-${item.id}`}>Unit cost ($)</label>
          <input
            id={`cost-${item.id}`}
            type="number"
            min="0"
            step="0.01"
            value={draft}
            disabled={busy}
            onChange={e => { setDraft(e.target.value); setNotice('') }}
          />
        </div>

        <button type="button" className="btn-primary btn-mini"
          disabled={busy || !dirty} onClick={save}>
          {busy ? 'Saving...' : 'Save cost'}
        </button>

        {dirty && !busy && (
          <button type="button" className="btn-cancel btn-mini"
            onClick={() => { setDraft(saved); setError('') }}>
            Undo
          </button>
        )}

        <span className="inv-cost-note">
          Receiving a supplier order sets this to the landed cost. Type over it if that
          is wrong. Past jobs keep the cost stamped on their own ledger rows.
        </span>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="set-notice" role="status">{notice}</p>}
    </section>
  )
}
