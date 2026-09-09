import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import {
  committedOf, formatCurrency, isLowStock, isShort, sortStockRows,
} from '../lib/inventory'
import { atReorderPoint } from '../lib/dashboard'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import AddItemModal from '../components/AddItemModal'
import LogTransactionModal from '../components/LogTransactionModal'
import InventoryOnOrderCell from '../components/InventoryOnOrderCell'
import InventoryReorder from '../components/InventoryReorder'
import ItemHistoryModal from '../components/ItemHistoryModal'
import StockMeter from '../components/StockMeter'
import './Inventory.css'

const ALL_CATEGORIES = 'all'

const STOCK_COLUMNS =
  'id, sku, name, category, variant, unit_cost, reorder_threshold, active, ' +
  'on_hand, stock_value, committed, available, on_order, expected_arrival'

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

  // At the reorder point but still sellable. This list came off the dashboard,
  // where it was drowning the parts that were genuinely short. It follows the
  // category filter, because a list that ignored it would contradict the table
  // right under it.
  const reorderRows = useMemo(() => atReorderPoint(visible), [visible])

  const committedUnits = useMemo(
    () => visible.reduce((sum, r) => sum + committedOf(r), 0),
    [visible],
  )

  const shortCount = useMemo(() => visible.filter(isShort).length, [visible])

  const onOrderUnits = useMemo(
    () => visible.reduce((sum, r) => sum + (Number(r.on_order) || 0), 0),
    [visible],
  )

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
              Log a movement
            </button>
            <button type="button" className="btn-primary" onClick={() => setOpenModal('add')} disabled={loading}>
              + Add item
            </button>
          </div>
        </div>

        {hasData && (
          <div className="inv-summary">
            <div className="inv-stat inv-stat-lead">
              <span className="inv-stat-label">Value on hand</span>
              <span className="inv-stat-value">{formatCurrency(totalValue)}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Items</span>
              <span className="inv-stat-value">{visible.length}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">Promised to booked jobs</span>
              <span className="inv-stat-value">{committedUnits}</span>
            </div>
            <div className={lowCount > 0 ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
              <span className="inv-stat-label">Needs reordering</span>
              <span className="inv-stat-value">{lowCount}</span>
            </div>
            <div className={shortCount > 0 ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
              <span className="inv-stat-label">Short</span>
              <span className="inv-stat-value">{shortCount}</span>
            </div>
            <div className="inv-stat">
              <span className="inv-stat-label">On order</span>
              <span className="inv-stat-value">{onOrderUnits}</span>
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

        {hasData && <InventoryReorder rows={reorderRows} />}

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
          <EmptyState
            title="No inventory items yet"
            actions={(
              <button type="button" className="btn-primary" onClick={() => setOpenModal('add')}>
                Add your first item
              </button>
            )}
          >
            <p>
              Stock on hand is never typed in directly. It is summed from the transaction
              ledger, so an item starts at zero and gets its count from a logged purchase.
            </p>
            <p>
              Add the parts you carry, log what is on the shelf as a purchase, then put those
              parts on a <Link to="/templates" className="tpl-link">template</Link> so
              installing a job deducts them automatically.
            </p>
          </EmptyState>
        )}

        {hasData && rows.length > 0 && visible.length === 0 && (
          <EmptyState title="No items in this category" tone="filtered" compact>
            <p>
              {rows.length} {rows.length === 1 ? 'item exists' : 'items exist'} in the
              catalog, but none are in this one. Change the category filter above.
            </p>
          </EmptyState>
        )}

        {hasData && visible.length > 0 && (
          <div className="table-wrap">
            <table className="jobs-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Category</th>
                  <th className="col-meter">Available</th>
                  <th className="col-num">On hand</th>
                  <th className="col-num">Promised</th>
                  <th className="col-num">On order</th>
                  <th className="col-num">Unit cost</th>
                  <th className="col-num">Value</th>
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
                    <td className="td-customer">
                      {row.name}
                      {!row.active && <span className="inv-inactive">Inactive</span>}
                      <span className="cell-sub">
                        {[row.sku, row.variant].filter(Boolean).join(', ')}
                      </span>
                    </td>
                    <td><span className="pill">{row.category}</span></td>
                    <td className="col-meter"><StockMeter row={row} /></td>
                    <td className="col-num">
                      <span className="inv-onhand">{row.on_hand}</span>
                      {isLowStock(row) && (
                        <span className="inv-low" title={`At or below the reorder point of ${row.reorder_threshold}, which is one job’s worth`}>
                          Reorder
                        </span>
                      )}
                    </td>
                    <td className="col-num">
                      {committedOf(row) === 0
                        ? <span className="inv-none">0</span>
                        : <span className="inv-committed"
                            title="Promised to booked jobs that have not been installed">
                            {committedOf(row)}
                          </span>}
                    </td>
                    <td className="col-num"><InventoryOnOrderCell row={row} /></td>
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
            Promised is what booked jobs have claimed but not yet consumed, and free to sell
            is on hand minus committed. On order is what is bought and not here yet, with
            the earliest date it is expected. Booking a job never moves stock. Only marking it
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
        <ItemHistoryModal
          item={rows.find(r => r.id === historyItem.id) || historyItem}
          onClose={() => setHistoryItem(null)}
          onChanged={load}
        />
      )}
    </AppShell>
  )
}
