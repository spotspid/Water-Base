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

export const SYSTEM_TEMPLATES = [
  { label: 'Flagship Bundle', price: 2999 },
  { label: 'Well Water Bundle', price: 3499 },
  { label: 'Softener Only', price: 1499 },
  { label: 'RO Only', price: 799 },
  { label: 'Custom', price: null },
]

export const FAUCET_FINISHES = [
  'Chrome',
  'Brushed Nickel',
  'Matte Black',
  'Oil-Rubbed Bronze',
  'Polished Gold',
]

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
