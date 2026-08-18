import { TXN_TYPES } from './constants'

export function txnTypeMeta(value) {
  return TXN_TYPES.find(t => t.value === value) || null
}

// the form collects a positive magnitude. direction comes from the txn type,
// or from the explicit add/remove choice when the type is an adjustment.
export function signedQuantity(txnType, magnitude, adjustDirection) {
  const meta = txnTypeMeta(txnType)
  const size = Math.abs(Number(magnitude))
  if (!meta || !Number.isFinite(size) || size === 0) return 0
  const whole = Math.trunc(size)
  if (meta.direction === 0) return adjustDirection === 'remove' ? -whole : whole
  return meta.direction * whole
}

// resolved direction for a type, taking the adjustment toggle into account
export function effectiveDirection(txnType, adjustDirection) {
  const meta = txnTypeMeta(txnType)
  if (!meta) return 0
  if (meta.direction === 0) return adjustDirection === 'remove' ? -1 : 1
  return meta.direction
}

export function formatCurrency(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '$0.00'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function formatSignedQty(qty) {
  const n = Number(qty) || 0
  return n > 0 ? `+${n}` : String(n)
}

export function formatDateTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })
}

export function isLowStock(row) {
  return Number(row.on_hand) <= Number(row.reorder_threshold)
}

// sort by category, then name, both case insensitive
export function sortStockRows(rows) {
  return [...rows].sort((a, b) => {
    const cat = String(a.category || '').localeCompare(String(b.category || ''), 'en', { sensitivity: 'base' })
    if (cat !== 0) return cat
    return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' })
  })
}

// newest first rows, balance shown is the on hand total immediately after that row
export function withRunningBalance(rowsNewestFirst) {
  const total = rowsNewestFirst.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0)
  let balance = total
  return rowsNewestFirst.map(r => {
    const after = balance
    balance -= Number(r.quantity) || 0
    return { ...r, balance_after: after }
  })
}
