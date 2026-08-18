import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatCurrency, isLowStock, sortStockRows } from '../lib/inventory'
import AppShell from '../components/AppShell'
import AddItemModal from '../components/AddItemModal'
import LogTransactionModal from '../components/LogTransactionModal'
import ItemHistoryModal from '../components/ItemHistoryModal'
import './Inventory.css'

const ALL_CATEGORIES = 'all'

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
    try {
      const { data, error: err } = await supabase
        .from('inventory_stock')
        .select('id, sku, name, category, variant, unit_cost, reorder_threshold, active, on_hand, stock_value')

      if (err) {
        setError(err.message)
        setRows([])
      } else {
        setRows(sortStockRows(data || []))
      }
    } catch (caught) {
      setError(caught?.message || 'Could not reach the database. Check your connection and try again.')
      setRows([])
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
            <div className={lowCount > 0 ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
              <span className="inv-stat-label">Low Stock</span>
              <span className="inv-stat-value">{lowCount}</span>
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
              If the inventory tables have not been created yet, apply the migration at
              {' '}<code>supabase/migrations/20260818_create_inventory.sql</code> and reload.
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
            Click a row to see its history.
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
