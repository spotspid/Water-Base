import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { useSettings } from '../lib/settings'
import {
  EXPENSE_SOURCES, formatCurrency, formatDate, monthsAgoIso, sumAmounts, todayIso,
} from '../lib/expenses'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import ExpenseModal from '../components/ExpenseModal'
import ExpenseBatches from '../components/ExpenseBatches'
import ImportWizard from '../components/ImportWizard'
import './Expenses.css'

const ALL = 'all'
const COLUMNS = 'id, spent_on, amount, vendor, category, description, source, import_batch'

export default function Expenses() {
  const { expenseCategories, loading: loadingSettings } = useSettings()

  const [rows, setRows] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [from, setFrom] = useState(monthsAgoIso(5))
  const [to, setTo] = useState(todayIso())
  const [category, setCategory] = useState(ALL)
  const [openModal, setOpenModal] = useState(null)
  const [editing, setEditing] = useState(null)
  const [removingId, setRemovingId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [expenseRes, batchRes] = await Promise.all([
      attempt(
        () => supabase.from('expenses').select(COLUMNS)
          .gte('spent_on', from).lte('spent_on', to)
          .order('spent_on', { ascending: false }),
        'Expenses could not be loaded.',
      ),
      attempt(
        () => supabase.from('expense_import_batches')
          .select('id, created_at, source, filename, row_count, total_amount, reversed_at')
          .order('created_at', { ascending: false }).limit(50),
        'Import history could not be loaded.',
      ),
    ])

    if (expenseRes.error) {
      setError(expenseRes.error)
      setRows([])
    } else {
      setRows(expenseRes.data || [])
    }

    setBatches(batchRes.error ? [] : (batchRes.data || []))
    setLoading(false)
  }, [from, to])

  useEffect(() => { load() }, [load])

  const visible = useMemo(
    () => (category === ALL ? rows : rows.filter(r => r.category === category)),
    [rows, category],
  )

  const total = useMemo(() => sumAmounts(visible), [visible])

  const byCategory = useMemo(() => {
    const totals = new Map()
    for (const row of visible) {
      totals.set(row.category, (totals.get(row.category) || 0) + Number(row.amount))
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])
  }, [visible])

  function handleSaved() {
    setOpenModal(null)
    setEditing(null)
    load()
  }

  async function handleDelete(row) {
    setError('')
    setRemovingId(row.id)

    const { error: err } = await attempt(
      () => supabase.from('expenses').delete().eq('id', row.id),
      'That expense could not be removed.',
    )

    setRemovingId('')
    if (err) setError(err)
    else load()
  }

  const hasData = !loading && !error

  return (
    <AppShell>
      <div className="exp-page">
        <div className="inv-header">
          <h1>Expenses</h1>
          <div className="inv-header-actions">
            <button type="button" className="btn-cancel" disabled={loading || loadingSettings}
              onClick={() => setOpenModal('import')}>
              Import
            </button>
            <button type="button" className="btn-primary" disabled={loading || loadingSettings}
              onClick={() => { setEditing(null); setOpenModal('expense') }}>
              + Add expense
            </button>
          </div>
        </div>

        <div className="exp-filters">
          <div className="field">
            <label htmlFor="from">From</label>
            <input id="from" type="date" value={from} max={to}
              onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <input id="to" type="date" value={to} min={from}
              onChange={e => setTo(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="cat">Category</label>
            <select id="cat" value={category} onChange={e => setCategory(e.target.value)}>
              <option value={ALL}>All categories</option>
              {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="inv-stat inv-stat-lead exp-total">
            <span className="inv-stat-label">Total in range</span>
            <span className="inv-stat-value">{formatCurrency(total)}</span>
          </div>
        </div>

        {loading && <p className="inv-state">Loading expenses...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">Expenses could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              This page reads <code>expenses</code> and <code>expense_import_batches</code>.
              If those are missing, apply
              {' '}<code>supabase/migrations/20260823000000_create_financials.sql</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && byCategory.length > 0 && (
          <div className="exp-chips">
            {byCategory.map(([name, amount]) => (
              <button key={name} type="button"
                className={category === name ? 'exp-chip active' : 'exp-chip'}
                onClick={() => setCategory(category === name ? ALL : name)}>
                <span className="exp-chip-name">{name}</span>
                <span className="exp-chip-value">{formatCurrency(amount)}</span>
              </button>
            ))}
          </div>
        )}

        {hasData && rows.length === 0 && (
          <EmptyState
            title="No expenses in this date range"
            actions={(
              <button type="button" className="btn-primary"
                onClick={() => { setEditing(null); setOpenModal('expense') }}>
                Add the first one
              </button>
            )}
          >
            <p>
              Expenses are everything the business spends that is not parts on a job or
              installer pay. Those two are already counted from the ledger and the job.
            </p>
            <p>
              Add one by hand, or import a card export and commit it as a batch that can
              be reversed if it turns out to be wrong.
            </p>
          </EmptyState>
        )}

        {hasData && rows.length > 0 && visible.length === 0 && (
          <EmptyState title="Nothing in this category" tone="filtered" compact>
            <p>{rows.length} expenses are in range, but none are in this one.</p>
          </EmptyState>
        )}

        {hasData && visible.length > 0 && (
          <div className="table-wrap">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="col-num">Amount</th>
                  <th>Vendor</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => (
                  <tr key={row.id}>
                    <td className="col-nowrap">{formatDate(row.spent_on)}</td>
                    <td className={Number(row.amount) < 0 ? 'col-num qty-in' : 'col-num col-value'}>
                      {formatCurrency(row.amount)}
                    </td>
                    <td className="td-customer">{row.vendor || ''}</td>
                    <td>{row.category}</td>
                    <td className="col-note">{row.description || ''}</td>
                    <td>
                      <span className={row.source === 'import' ? 'txn-badge txn-purchase' : 'txn-badge txn-adjustment'}>
                        {EXPENSE_SOURCES[row.source] || row.source}
                      </span>
                    </td>
                    <td className="col-num exp-actions">
                      <button type="button" className="tpl-link"
                        onClick={() => { setEditing(row); setOpenModal('expense') }}>
                        Edit
                      </button>
                      {row.source === 'manual' && (
                        <button type="button" className="tpl-link exp-remove"
                          disabled={removingId === row.id}
                          onClick={() => handleDelete(row)}>
                          {removingId === row.id ? 'Removing...' : 'Remove'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasData && (
          <p className="inv-ledger-note">
            An imported row is removed by reversing its batch, not one at a time, so the
            batch totals stay true to what was committed.
          </p>
        )}

        {hasData && <ExpenseBatches batches={batches} onChanged={load} />}
      </div>

      {openModal === 'expense' && (
        <ExpenseModal
          expense={editing}
          categories={expenseCategories}
          onClose={() => { setOpenModal(null); setEditing(null) }}
          onSaved={handleSaved}
        />
      )}

      {openModal === 'import' && (
        <ImportWizard
          categories={expenseCategories}
          onClose={() => setOpenModal(null)}
          onImported={load}
        />
      )}
    </AppShell>
  )
}
