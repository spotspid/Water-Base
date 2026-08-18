import { PICK_SOURCES, PICK_SOURCE_LABELS } from './constants'

export function pickSourceMeta(value) {
  return PICK_SOURCES.find(s => s.value === value) || null
}

export function pickSourceLabel(value) {
  return PICK_SOURCE_LABELS[value] || value || ''
}

export function sortTemplates(rows) {
  return [...rows].sort((a, b) => {
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0)
    if (order !== 0) return order
    return String(a.label || '').localeCompare(String(b.label || ''), 'en', { sensitivity: 'base' })
  })
}

export function sortLines(rows) {
  return [...rows].sort((a, b) => {
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0)
    if (order !== 0) return order
    return String(a.id).localeCompare(String(b.id))
  })
}

export function groupLinesByTemplate(rows) {
  const map = new Map()
  for (const row of rows) {
    const list = map.get(row.template_id)
    if (list) list.push(row)
    else map.set(row.template_id, [row])
  }
  for (const [key, list] of map) map.set(key, sortLines(list))
  return map
}

// Candidate items for a customer pick line: active items in the pick category
// that actually carry a variant, since the variant is what gets matched.
export function pickCandidates(items, category) {
  return items
    .filter(i => i.active !== false && i.category === category && i.variant)
    .sort((a, b) => String(a.variant).localeCompare(String(b.variant), 'en', { sensitivity: 'base' }))
}

// A template costs a fixed amount plus whatever the customer picks, so the
// total is a range rather than a number whenever a pick line is present.
export function templateCost(lines, items) {
  let fixed = 0
  let pickMin = 0
  let pickMax = 0
  let unpriced = 0

  for (const line of lines) {
    const qty = Number(line.quantity) || 0

    if (line.line_type === 'fixed') {
      fixed += qty * (Number(line.unit_cost) || 0)
      continue
    }

    const options = pickCandidates(items, line.pick_category)
    if (options.length === 0) {
      unpriced += 1
      continue
    }
    const costs = options.map(o => qty * (Number(o.unit_cost) || 0))
    pickMin += Math.min(...costs)
    pickMax += Math.max(...costs)
  }

  return {
    low: fixed + pickMin,
    high: fixed + pickMax,
    isRange: pickMin !== pickMax,
    unpricedPickLines: unpriced,
  }
}

// Which finishes this template can actually be installed with. A finish with
// no matching inventory item will block the deduct, so the UI warns early.
export function unsupportedFinishes(lines, items, finishes) {
  const pickLines = lines.filter(l => l.line_type === 'customer_pick')
  if (pickLines.length === 0) return []

  return finishes.filter(finish =>
    pickLines.some(line =>
      !items.some(i =>
        i.active !== false && i.category === line.pick_category && i.variant === finish,
      ),
    ),
  )
}

export function lineLabel(line) {
  if (line.line_type === 'customer_pick') {
    return `${pickSourceLabel(line.pick_source)} (customer pick)`
  }
  return line.item_name || 'Unknown item'
}

export function lineDetail(line) {
  if (line.line_type === 'customer_pick') {
    return `Any active ${line.pick_category} item whose variant matches the job`
  }
  return [line.sku, line.item_variant].filter(Boolean).join(' : ')
}
