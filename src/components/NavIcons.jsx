// Nav and shell icons, kept together so AppShell stays about layout.
//
// All 24 by 24, stroke only, inheriting currentColor from the nav item.
//
// One stroke weight across the whole set. Three of these used to differ, and
// at 18px in a rail that reads as some icons being bolder than others rather
// than as a deliberate difference. Every icon spends its weight on the same
// line, so the row reads as one set.
//
// Geometric and functional rather than illustrative: a shape that says what
// the destination holds, drawn with the fewest lines that still name it.

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
}

export function IconDashboard() {
  return (
    <svg {...base}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  )
}

export function IconSchedule() {
  return (
    <svg {...base}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}

export function IconJobs() {
  return (
    <svg {...base}>
      <path d="M3 7h18v13H3z" />
      <path d="M9 7V4h6v3" />
    </svg>
  )
}

export function IconInventory() {
  return (
    <svg {...base}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5Z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </svg>
  )
}

export function IconBuildSheets() {
  return (
    <svg {...base}>
      <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
    </svg>
  )
}

export function IconExpenses() {
  return (
    <svg {...base}>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  )
}

export function IconMoney() {
  return (
    <svg {...base}>
      <path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}

// Three sliders rather than a cogwheel. The gear was a twelve tooth path that
// turned to mush at 18px and was the one decorative shape in an otherwise
// geometric set. Settings here are lists and values, which is what this draws.
export function IconSettings() {
  return (
    <svg {...base}>
      <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h10M18 17h2" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="16" cy="17" r="2" />
    </svg>
  )
}

// A delivery box, for stock that is bought but not yet here
export function IconOrders() {
  return (
    <svg {...base}>
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
      <path d="M3 7.5 12 12l9-4.5" />
      <path d="M12 12v9" />
    </svg>
  )
}

// A sheet with a signature line, for the paperwork a job needs signed.
export function IconDocuments() {
  return (
    <svg {...base}>
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 16.5c1.2-1.6 2-2.4 2.6-2.4.9 0 .6 2.4 1.5 2.4.6 0 1.2-.7 1.9-1.6" />
    </svg>
  )
}
