import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import {
  availableOf, committedOf, formatCurrency, isLowStock, isShort, sortStockRows,
} from '../lib/inventory'
import AppShell from '../components/AppShell'
import AddItemModal from '../components/AddItemModal'
import LogTransactionModal from '../components/LogTransactionModal'
import ItemHistoryModal from '../components/ItemHistoryModal'
import './Inventory.css'

const ALL_CATEGORIES = 'all'

const STOCK_COLUMNS =
  'id, sku, name, category, variant, unit_cost, reorder_threshold, active, ' +
  'on_hand, stock_value, committed, available'

export default function Inventory() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const [openModal, setOpenModal] = useState(null)
  const [historyItem, setHistoryItem] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => supabase.from('inventory_stock').select(STOCK_COLUMNS),
      'Inventory could not be loaded.',
    )

    if (err) {
      setError(err)
      setRows([])
    } else {
      setRows(sortStockRows(data || []))
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => {
    const set = new Set(rows.map(r => r.category).filter(Boolean))
    return [...set].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
  }, [rows])

  const visible = useMemo(
    () => (category === ALL_CATEGORIES ? rows : rows.filter(r => r.category === category)),
    [rows, category],
  )

  const totalValue = useMemo(
    () => visible.reduce((sum, r) => sum + (Number(r.stock_value) || 0), 0),
    [visible],
  )

  const lowCount = useMemo(() => visible.filter(isLowStock).length, [visible])

  const committedUnits = useMemo(
    () => visible.reduce((sum, r) => sum + committedOf(r), 0),
    [visible],
  )

  const shortCount = useMemo(() => visible.filter(isShort).length, [visible])

  function handleSaved() {
    setOpenModal(null)
    load()
  }

  const hasData = !loading && !error

  return (
    <AppShell>
      <div className="inv-page">
        <div className="inv-header">
          <h1>Inventory</h1>
          <div className="inv-header-actions">
            <button type="button" className="btn-cancel"
              onClick={() => setOpenModal('log')} disabled={loading || !!error || rows.length === 0}>
              Log Transaction
            </button>
            <button type="button" className="btn-primary" onClick={() => setOpenModal('add')} disabled={loading}>
              + Add Item
            </button>
          </div>
        </div>

        {hasData && (
          <div className="inv-summary">
            <div className="inv-stat inv-stat-lead">
              <span className="inv-stat-label">Total Stock Value</span>
              <span className="inv-stat-value">{formatCurrency(totalValue)}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Items</span>
              <span className="inv-stat-value">{visible.length}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Committed</span>
              <span className="inv-stat-value">{committedUnits}</span>
            </div>
            <div className={lowCount > 0 ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
              <span className="inv-stat-label">Low Stock</span>
              <span className="inv-stat-value">{lowCount}</span>
            </div>
            <div className={shortCount > 0 ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
              <span className="inv-stat-label">Oversold</span>
              <span className="inv-stat-value">{shortCount}</span>
            </div>
            <div className="inv-filter">
              <label htmlFor="category-filter">Category</label>
              <select id="category-filter" value={category} onChange={e => setCategory(e.target.value)}>
                <option value={ALL_CATEGORIES}>All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        )}

        {loading && <p className="inv-state">Loading inventory...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">Inventory could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              This page reads the <code>inventory_stock</code> view, including its committed
              and available columns. If those are missing, apply the migrations in
              {' '}<code>supabase/migrations</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && rows.length === 0 && (
          <p className="inv-state">No inventory items yet. Add your first one.</p>
        )}

        {hasData && rows.length > 0 && visible.length === 0 && (
          <p className="inv-state">No items in this category.</p>
        )}

        {hasData && visible.length > 0 && (
          <div className="table-wrap">
            <table className="jobs-table inv-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Variant</th>
                  <th className="col-num">On Hand</th>
                  <th className="col-num">Committed</th>
                  <th className="col-num">Available</th>
                  <th className="col-num">Unit Cost</th>
                  <th className="col-num">Stock Value</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(row => (
                  <tr key={row.id} className="inv-row" tabIndex={0}
                    onClick={() => setHistoryItem(row)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setHistoryItem(row)
                      }
                    }}>
                    <td className="col-sku">{row.sku}</td>
                    <td className="td-customer">
                      {row.name}
                      {!row.active && <span className="inv-inactive">Inactive</span>}
                    </td>
                    <td>{row.category}</td>
                    <td>{row.variant || ''}</td>
                    <td className="col-num">
                      <span className="inv-onhand">{row.on_hand}</span>
                      {isLowStock(row) && (
                        <span className="inv-low" title={`At or below reorder threshold of ${row.reorder_threshold}`}>
                          Low
                        </span>
                      )}
                    </td>
                    <td className="col-num">
                      {committedOf(row) === 0
                        ? <span className="inv-none">0</span>
                        : <span className="inv-committed"
                            title="Claimed by booked jobs that have not been installed">
                            {committedOf(row)}
                          </span>}
                    </td>
                    <td className="col-num">
                      <span className={isShort(row) ? 'inv-available inv-available-short' : 'inv-available'}>
                        {availableOf(row)}
                      </span>
                      {isShort(row) && (
                        <span className="inv-low"
                          title="More is committed to jobs than is on the shelf">
                          Short
                        </span>
                      )}
                    </td>
                    <td className="col-num">{formatCurrency(row.unit_cost)}</td>
                    <td className="col-num col-value">{formatCurrency(row.stock_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasData && visible.length > 0 && (
          <p className="inv-ledger-note">
            On hand is summed from the transaction ledger and is never edited directly.
            Committed is what booked jobs have claimed but not yet consumed, and available
            is on hand minus committed. Booking a job never moves stock. Only marking it
            installed writes to the ledger. Click a row to see its history.
          </p>
        )}
      </div>

      {openModal === 'add' && (
        <AddItemModal onClose={() => setOpenModal(null)} onSaved={handleSaved} />
      )}

      {openModal === 'log' && (
        <LogTransactionModal items={rows} onClose={() => setOpenModal(null)} onSaved={handleSaved} />
      )}

      {historyItem && (
        <ItemHistoryModal item={historyItem} onClose={() => setHistoryItem(null)} />
      )}
    </AppShell>
  )
}
