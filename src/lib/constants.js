export const SERVICE_CITIES = [
  'Ann Arbor',
  'Brighton',
  'Canton',
  'Chelsea',
  'Dexter',
  'Dundee',
  'Howell',
  'Livonia',
  'Milan',
  'Monroe',
  'Northville',
  'Plymouth',
  'Saline',
  'South Lyon',
  'Superior Township',
  'Tecumseh',
  'Whitmore Lake',
  'Ypsilanti',
]

export const FAUCET_FINISHES = [
  'Chrome',
  'Brushed Nickel',
  'Matte Black',
  'Oil-Rubbed Bronze',
  'Polished Gold',
]

// A template line can defer one part to the customer. pick_source names the
// job field that carries the choice, pick_category narrows which inventory
// items are candidates, and the match is made on inventory_items.variant.
// Adding a source here also needs a matching branch in the SQL function
// resolve_template_parts.
export const PICK_SOURCES = [
  {
    value: 'faucet_finish',
    label: 'Faucet Finish',
    jobField: 'faucet_finish',
    defaultCategory: 'Faucet',
    help: 'Resolves to the item whose variant matches the finish chosen on the job.',
  },
]

export const PICK_SOURCE_LABELS = {
  faucet_finish: 'Faucet Finish',
}

export const PAYMENT_TYPES = [
  'Cash',
  'Check',
  'Credit Card',
  'Financing',
]

export const STATUS_LABELS = {
  sold: 'Sold',
  scheduled: 'Scheduled',
  installed: 'Installed',
}

export const INVENTORY_CATEGORIES = [
  'Softener',
  'RO System',
  'Filter',
  'Media',
  'Faucet',
  'Fittings',
  'Tubing',
  'Valve',
  'Tank',
  'Consumable',
  'Tools',
  'Other',
]

// direction: 1 adds to on hand, -1 removes from on hand, 0 lets the user pick.
// the UI never asks anyone to type a negative number.
export const TXN_TYPES = [
  { value: 'purchase', label: 'Purchase', direction: 1, help: 'Stock received into inventory' },
  { value: 'return', label: 'Return', direction: 1, help: 'Stock returned to inventory' },
  { value: 'install', label: 'Install', direction: -1, help: 'Stock consumed on a job' },
  { value: 'damage', label: 'Damage', direction: -1, help: 'Stock written off as damaged' },
  { value: 'adjustment', label: 'Adjustment', direction: 0, help: 'Manual count correction, either direction' },
]

export const TXN_TYPE_LABELS = {
  purchase: 'Purchase',
  return: 'Return',
  install: 'Install',
  damage: 'Damage',
  adjustment: 'Adjustment',
}

export const DEFAULT_LOCATION = 'Unit 4030'
