// Shared expense helpers. Formatting and parsing only, no data access, so the
// import preview and the manual form agree on what a date or an amount means.

export const EXPENSE_SOURCES = {
  manual: 'Manual',
  import: 'Imported',
}

export function formatCurrency(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '$0.00'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

// Dates coming back from Postgres are plain YYYY-MM-DD with no zone. Passing
// that straight to new Date() reads it as UTC midnight, which renders as the
// previous day for anyone west of Greenwich. Splitting the parts avoids it.
export function formatDate(value) {
  const iso = String(value || '').slice(0, 10)
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function formatMonth(value) {
  const iso = String(value || '').slice(0, 10)
  const [y, m] = iso.split('-').map(Number)
  if (!y || !m) return ''
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  })
}

export function formatMonthShort(value) {
  const iso = String(value || '').slice(0, 10)
  const [y, m] = iso.split('-').map(Number)
  if (!y || !m) return ''
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
    month: 'short', year: 'numeric',
  })
}

export function todayIso() {
  const now = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function monthsAgoIso(count) {
  const now = new Date()
  const back = new Date(now.getFullYear(), now.getMonth() - count, 1)
  const pad = n => String(n).padStart(2, '0')
  return `${back.getFullYear()}-${pad(back.getMonth() + 1)}-01`
}

// Accepts the shapes that actually turn up in exported statements:
// 2026-08-03, 08/03/2026, 8/3/26, 2026/08/03. Returns ISO or an empty string.
export function parseDate(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return ''

  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/)
  if (iso) return buildIso(iso[1], iso[2], iso[3])

  const us = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/)
  if (us) {
    const year = us[3].length === 2 ? String(2000 + Number(us[3])) : us[3]
    return buildIso(year, us[1], us[2])
  }

  // last resort, for formats like "Aug 3, 2026" that Date can read reliably
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime())) {
    const pad = n => String(n).padStart(2, '0')
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`
  }

  return ''
}

function buildIso(y, m, d) {
  const year = Number(y)
  const month = Number(m)
  const day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

// Handles $, thousands separators, and the accounting convention of wrapping
// a negative in parentheses. Returns null when there is no number to find.
export function parseAmount(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null

  const negative = /^\(.*\)$/.test(text)
  const cleaned = text.replace(/[()$\s,]/g, '')
  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null

  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null

  return Math.round((negative ? -value : value) * 100) / 100
}

// The key the database duplicate check compares on, mirrored here so the
// preview can also flag rows that repeat within the same file.
export function duplicateKey(row) {
  const vendor = String(row.vendor || '').trim().toLowerCase()
  return `${row.spent_on}|${Number(row.amount).toFixed(2)}|${vendor}`
}

export function sumAmounts(rows) {
  return rows.reduce((total, r) => total + (Number(r.amount) || 0), 0)
}
