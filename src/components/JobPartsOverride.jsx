import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt, attemptRows } from '../lib/errors'
import { formatCurrency } from '../lib/inventory'

// Parts listed against one job rather than on a build sheet.
//
// For the job that is not a bundle. Three jobs are on the "Custom" sheet,
// which carries no lines, and a sheet with no lines resolves cleanly because
// nothing to resolve cannot fail. Those jobs claim nothing, deduct nothing and
// record a parts cost of zero against a real sale, which makes their margin
// fiction rather than an estimate.
//
// Any row here replaces the sheet for this job entirely. That is the database's
// rule, not this component's, and it is said out loud on screen because a list
// that silently half applied would be worse than either behaviour.
//
// Every write goes straight to job_parts, whose triggers resync the claim and
// refuse the edit outright on an installed job. This does not re-implement
// either rule, it reports what comes back.
export default function JobPartsOverride({ job, onChanged }) {
  const [rows, setRows] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState({ item_id: '', quantity: '1', note: '' })

  const jobId = job.id
  const installed = job.parts_deducted_at != null

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [listed, stock] = await Promise.all([
      attempt(
        () => supabase
          .from('job_parts')
          .select('id, item_id, quantity, note, sort_order')
          .eq('job_id', jobId)
          .order('sort_order')
          .order('created_at'),
        'The parts listed against this job could not be loaded.',
      ),
      attempt(
        () => supabase
          .from('inventory_items')
          .select('id, sku, name, variant, unit_cost, active, category')
          .order('sku'),
        'The inventory list could not be loaded.',
      ),
    ])

    if (listed.error || stock.error) {
      setError(listed.error || stock.error)
      setRows([])
      setItems([])
      setLoading(false)
      return
    }

    setRows(listed.data || [])
    setItems(stock.data || [])
    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  // An item already listed is not offered again: one row per item is a
  // constraint, and offering a duplicate only to refuse it is a worse form.
  const choices = useMemo(() => {
    const taken = new Set(rows.map(r => r.item_id))
    return items.filter(i => i.active !== false && !taken.has(i.id))
  }, [items, rows])

  const byId = useMemo(
    () => Object.fromEntries(items.map(i => [i.id, i])),
    [items],
  )

  async function run(work) {
    setError('')
    setBusy(true)

    const { error: failed } = await work()

    setBusy(false)

    if (failed) {
      setError(failed)
      // the job may have installed under us, so pull fresh rows either way
      load()
      return
    }

    await load()
    onChanged()
  }

  function handleAdd(e) {
    e.preventDefault()

    if (!adding.item_id) {
      setError('Pick an item to add.')
      return
    }

    const quantity = Number(adding.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError('Quantity must be a whole number of one or more.')
      return
    }

    run(async () => {
      const { error: failed } = await attempt(
        () => supabase.from('job_parts').insert({
          job_id: jobId,
          item_id: adding.item_id,
          quantity,
          note: adding.note.trim() || null,
          sort_order: rows.length * 10,
        }).select('id').single(),
        'That part could not be listed against this job.',
      )

      if (!failed) setAdding({ item_id: '', quantity: '1', note: '' })

      return { error: failed }
    })
  }

  function handleQuantity(row, value) {
    const quantity = Number(value)
    if (!Number.isInteger(quantity) || quantity < 1) {
      setError('Quantity must be a whole number of one or more.')
      return
    }

    if (quantity === row.quantity) return

    run(() => attemptRows(
      () => supabase.from('job_parts').update({ quantity }).eq('id', row.id),
      'That quantity could not be saved.',
    ))
  }

  function handleRemove(row) {
    run(() => attemptRows(
      () => supabase.from('job_parts').delete().eq('id', row.id),
      'That part could not be taken off this job.',
    ))
  }

  if (loading) {
    return <p className="inv-state">Loading this job&rsquo;s own parts...</p>
  }

  return (
    <div className="job-parts-own">
      <h4>Parts listed against this job</h4>

      {error && (
        <p className="form-error" role="alert">{error}</p>
      )}

      {installed && (
        <p className="inv-ledger-note">
          This job is installed and its parts are in the ledger, which is append only,
          so this list is fixed. Reverse the install to change it.
        </p>
      )}

      {rows.length === 0 && !installed && (
        <p className="inv-state">
          Nothing listed. This job uses its build sheet. Add a part here and the sheet
          stops applying to this job altogether, so list everything it needs.
        </p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="col-num">Qty</th>
                <th className="col-num">Unit Cost</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const item = byId[row.item_id]
                return (
                  <tr key={row.id}>
                    <td className="td-customer">
                      {item
                        ? <>{item.sku} <span className="tpl-line-note">{item.name}{item.variant ? ` (${item.variant})` : ''}</span></>
                        : <span className="job-parts-none">This item is no longer in inventory</span>}
                    </td>
                    <td className="col-num">
                      <input
                        type="number" min="1" step="1" className="qty-input"
                        defaultValue={row.quantity}
                        disabled={busy || installed}
                        onBlur={e => handleQuantity(row, e.target.value)}
                        aria-label={`Quantity for ${item?.sku || 'this part'}`}
                      />
                    </td>
                    <td className="col-num">{item ? formatCurrency(item.unit_cost) : ''}</td>
                    <td><span className="tpl-line-note">{row.note || ''}</span></td>
                    <td className="col-num">
                      <button
                        type="button" className="btn-cancel"
                        disabled={busy || installed}
                        onClick={() => handleRemove(row)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!installed && (
        <form className="form-grid" onSubmit={handleAdd}>
          <div className="field">
            <label htmlFor="job_part_item">Add a part</label>
            <select
              id="job_part_item" name="item_id" value={adding.item_id}
              disabled={busy || choices.length === 0}
              onChange={e => setAdding(a => ({ ...a, item_id: e.target.value }))}
            >
              <option value="">
                {choices.length === 0 ? 'Every item is already listed' : 'Select item...'}
              </option>
              {choices.map(i => (
                <option key={i.id} value={i.id}>
                  {i.sku} - {i.name}{i.variant ? ` (${i.variant})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="job_part_qty">Quantity</label>
            <input
              id="job_part_qty" name="quantity" type="number" min="1" step="1"
              value={adding.quantity} disabled={busy}
              onChange={e => setAdding(a => ({ ...a, quantity: e.target.value }))}
            />
          </div>

          <div className="field field-full">
            <label htmlFor="job_part_note">Note <span className="optional">(optional)</span></label>
            <input
              id="job_part_note" name="note" type="text"
              value={adding.note} disabled={busy}
              onChange={e => setAdding(a => ({ ...a, note: e.target.value }))}
            />
          </div>

          <div className="form-actions field-full">
            <button type="submit" className="btn-primary" disabled={busy || !adding.item_id}>
              {busy ? 'Saving...' : 'Add to this job'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
