import { createContext, useContext } from 'react'

// The context object and every non component helper that goes with it. The
// provider itself lives in SettingsProvider.jsx so each file exports one kind
// of thing and fast refresh keeps working.
export const SettingsContext = createContext(null)

export const OPTION_LISTS = [
  'inventory_category',
  'service_city',
  'faucet_finish',
  'payment_type',
  'time_window',
  'expense_category',
  'ro_type',
  'valve_type',
]

export const DIRECTION_LABELS = {
  '1': 'Adds to stock',
  '-1': 'Removes from stock',
  '0': 'Either direction',
}

export function useSettings() {
  const value = useContext(SettingsContext)
  if (!value) {
    throw new Error('useSettings must be used inside a SettingsProvider')
  }
  return value
}

function compareByOrder(a, b, field) {
  const order = (a.sort_order ?? 0) - (b.sort_order ?? 0)
  if (order !== 0) return order
  return String(a[field]).localeCompare(String(b[field]), 'en', { sensitivity: 'base' })
}

export function groupOptions(rows) {
  const lists = {}
  for (const key of OPTION_LISTS) lists[key] = []

  for (const row of rows) {
    if (lists[row.list_key]) lists[row.list_key].push(row)
  }

  for (const key of OPTION_LISTS) {
    lists[key].sort((a, b) => compareByOrder(a, b, 'value'))
  }

  return lists
}

export function sortTxnTypes(rows) {
  return [...rows].sort((a, b) => compareByOrder(a, b, 'label'))
}

export function readScalars(rows) {
  const byKey = new Map(rows.map(r => [r.key, r]))
  const location = byKey.get('default_location')?.text_value

  return {
    defaultLocation: location || '',
  }
}

// A dropdown that edits an existing record has to keep showing the value that
// record already holds, even after an operator turns that option off.
export function withCurrent(list, current) {
  if (!current || list.includes(current)) return list
  return [...list, current]
}

// There is deliberately no defaultInstallerPay here any more. The amount varies
// by installer and by job, so a single house rate prefilled a number that was
// wrong more often than right. It is typed on the job, every time.
