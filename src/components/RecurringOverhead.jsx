import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { formatCurrency } from '../lib/expenses'
import {
  DUE, NEEDS_AMOUNT, POSTED, hasOutstanding, overheadTotals, stateLabel, stateTone,
} from '../lib/recurring'
import RecurringCostForm from './RecurringCostForm'

// The overheads that arrive every month: ad spend, software, storage, insurance.
//
// The panel answers one question, which is what this month is still missing
// from the books. A fixed cost posts itself on a press. A varying one asks for
// the figure, because only Meta knows what Meta charged and guessing it would
// put a confident wrong number into the P&L.
//
// Posting writes an ordinary expense row, so the table below this panel, the
// category chips and the P&L all pick it up with no knowledge of any of this.
export default function RecurringOverhead({ categories, onPosted }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [editing, setEditing] = useState(null)
  const [amounts, setAmounts] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: failed } = await attempt(
      () => supabase.from('recurring_expense_status').select('*').order('vendor'),
      'The recurring overheads could not be loaded.',
    )
    if (failed) setError(failed)
    else {
      setError('')
      setRows(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function done() {
    load()
    if (onPosted) onPosted()
  }

  async function postOne(row) {
    const typed = amounts[row.id]
    setBusy(row.id)
    const { error: failed } = await attempt(
      () => supabase.rpc('post_recurring_expense', {
        p_recurring_id: row.id,
        p_amount: row.amount_varies ? Number(String(typed).replace(/[$,\s]/g, '')) : null,
      }),
      `${row.vendor} could not be posted.`,
    )
    setBusy('')
    if (failed) setError(failed)
    else {
      setError('')
      setAmounts(a => ({ ...a, [row.id]: '' }))
      done()
    }
  }

  async function postAllDue() {
    setBusy('all')
    const { error: failed } = await attempt(
      () => supabase.rpc('post_due_recurring_expenses', {}),
      'The fixed overheads could not be posted.',
    )
    setBusy('')
    if (failed) setError(failed)
    else { setError(''); done() }
  }

  const totals = overheadTotals(rows)
  const dueCount = rows.filter(r => r.state === DUE).length

  return (
    <section className="rec-panel">
      <div className="rec-head">
        <div>
          <h2>Monthly overhead</h2>
          <p className="rec-sub">
            {loading ? 'Loading...' : summary(totals, rows)}
          </p>
        </div>
        <div className="rec-head-actions">
          {dueCount > 0 && (
            <button type="button" className="btn-primary btn-small"
              onClick={postAllDue} disabled={busy !== ''}>
              {busy === 'all' ? 'Posting...' : `Post ${dueCount} fixed`}
            </button>
          )}
          <button type="button" className="btn-cancel btn-small"
            onClick={() => setEditing({})} disabled={busy !== ''}>
            Add a standing cost
          </button>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {!loading && rows.length === 0 && (
        <p className="rec-empty">
          Nothing set up yet. Add your ad spend and each subscription once, and
          this page will stop depending on somebody remembering them.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="rec-list">
          {rows.map(row => (
            <li key={row.id} className={`rec-row rec-${stateTone(row)}`}>
              <div className="rec-what">
                <span className="rec-vendor">{row.vendor}</span>
                <span className="rec-meta">
                  {row.category} &middot; day {row.day_of_month}
                  {row.amount_varies ? ' · varies' : ` · ${formatCurrency(row.amount)}`}
                </span>
              </div>

              <span className={`rec-badge rec-badge-${stateTone(row)}`}>{stateLabel(row)}</span>

              <div className="rec-act">
                {row.state === POSTED && (
                  <span className="rec-posted">{formatCurrency(row.posted_amount)}</span>
                )}

                {row.state === NEEDS_AMOUNT && (
                  <>
                    <label className="rec-amount-label" htmlFor={`rec_${row.id}`}>
                      This month
                    </label>
                    <input id={`rec_${row.id}`} type="text" inputMode="decimal"
                      className="rec-amount" placeholder="0.00"
                      value={amounts[row.id] || ''} disabled={busy !== ''}
                      onChange={e => setAmounts(a => ({ ...a, [row.id]: e.target.value }))} />
                    <button type="button" className="btn-primary btn-small"
                      disabled={busy !== '' || String(amounts[row.id] || '').trim() === ''}
                      onClick={() => postOne(row)}>
                      {busy === row.id ? 'Posting...' : 'Post'}
                    </button>
                  </>
                )}

                {row.state === DUE && (
                  <button type="button" className="btn-cancel btn-small"
                    disabled={busy !== ''} onClick={() => postOne(row)}>
                    {busy === row.id ? 'Posting...' : 'Post'}
                  </button>
                )}

                <button type="button" className="rec-edit" disabled={busy !== ''}
                  onClick={() => setEditing(row)}>
                  Edit
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <RecurringCostForm
          cost={editing.id ? editing : null}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); done() }}
        />
      )}
    </section>
  )
}

// What the month is still missing, said as a sentence rather than a count.
// The figure that matters is what is not in the books yet, because that is
// the amount the P&L is currently overstating profit by.
function summary(totals, rows) {
  if (totals.count === 0) return 'No standing costs set up.'
  if (!hasOutstanding(rows)) {
    return `All ${totals.count} posted this month, ${formatCurrency(totals.posted)} in total.`
  }

  const parts = []
  if (totals.readyToPost > 0) parts.push(`${formatCurrency(totals.readyToPost)} ready to post`)
  if (totals.unknownCount > 0) {
    parts.push(`${totals.unknownCount} waiting on ${totals.unknownCount === 1 ? 'a figure' : 'figures'}`)
  }
  return `${formatCurrency(totals.posted)} posted so far. ${parts.join(', ')}.`
}
