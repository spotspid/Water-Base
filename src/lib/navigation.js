// Where you can go, and what you will find there.
//
// Data rather than markup, so the top bar, the menus and the page title all
// read one list. Adding a destination is one entry here.
//
// Grouped three ways because that is how the work splits: what is happening
// today, what is on the shelf, what it earned. Nine flat links across a bar
// would be a row to search rather than a place to go.
//
// Settings used to sit under Money, where it never belonged. It is not a
// number, it is the configuration behind all of them, so it now lives in the
// account menu with sign out.

export const GROUPS = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { to: '/dashboard', text: 'Dashboard', hint: 'Shortages, revenue, recent activity' },
      { to: '/schedule', text: 'Schedule', hint: 'Crew, dates, parts readiness' },
      { to: '/jobs', text: 'Jobs', hint: 'Status, documents, margin' },
    ],
  },
  {
    id: 'stock',
    label: 'Stock',
    items: [
      { to: '/inventory', text: 'Inventory', hint: 'On hand, promised, on order' },
      { to: '/orders', text: 'Supplier orders', hint: 'What is coming, and when' },
      { to: '/templates', text: 'Build sheets', hint: 'Parts per system' },
    ],
  },
  {
    id: 'money',
    label: 'Money',
    items: [
      { to: '/expenses', text: 'Expenses', hint: 'Overheads and one-offs' },
      { to: '/pnl', text: 'Profit and loss', hint: 'Revenue less parts, pay, expenses' },
    ],
  },
]

// Reachable from the account menu rather than the bar.
export const ACCOUNT_ITEMS = [
  { to: '/settings', text: 'Settings', hint: 'Lists, crew, agreements' },
]

// Titles are operational labels, not explanations. They name what the page
// holds, so the bar says what you can read here rather than selling it.
const TITLES = {
  '/dashboard': ['Dashboard', 'Today'],
  '/schedule': ['Schedule', 'Crew and dates'],
  '/jobs': ['Jobs', 'Status and margin'],
  '/jobs/new': ['New job', 'Parts are claimed when it is scheduled'],
  '/inventory': ['Inventory', 'On hand, promised, on order'],
  '/orders': ['Supplier orders', 'On order and arrival dates'],
  '/templates': ['Build sheets', 'Parts per system'],
  '/expenses': ['Expenses', 'Overheads and one-offs'],
  '/pnl': ['Profit and loss', 'Revenue, parts, pay, expenses'],
  '/settings': ['Settings', 'Lists, crew, agreements'],
}

/**
 * The title and subtitle for a path.
 *
 * Falls back to the first segment, so /jobs/some-id still says Jobs rather
 * than going blank, and then to the product name so the bar is never empty.
 */
export function titleFor(pathname) {
  const path = String(pathname || '')
  return TITLES[path]
    || TITLES[`/${path.split('/')[1] || ''}`]
    || ['Water Base', '']
}

/**
 * Which group owns a path, so its trigger can show as current.
 *
 * Matches on the first segment rather than the whole path, because /jobs/new
 * is still Operations and a menu that went quiet on a sub page would make the
 * bar look broken.
 */
export function groupForPath(pathname) {
  const first = `/${String(pathname || '').split('/')[1] || ''}`

  for (const group of GROUPS) {
    if (group.items.some(item => item.to === first)) return group.id
  }

  return ''
}

// Whether a nav entry should read as the page you are on.
export function isCurrent(to, pathname) {
  const first = `/${String(pathname || '').split('/')[1] || ''}`
  return to === first
}
