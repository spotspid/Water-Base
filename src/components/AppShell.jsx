import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import {
  IconBuildSheets, IconDashboard, IconExpenses, IconInventory,
  IconJobs, IconMoney, IconOrders, IconSchedule, IconSettings,
} from './NavIcons'
import emblem from '../assets/emblem.png'
import './AppShell.css'

// Nav is grouped, because seven flat links read as a list to search rather
// than as a place to go. The groups match how the work actually splits: what
// is happening, what is on the shelf, what it earned.
const GROUPS = [
  {
    label: 'Operations',
    items: [
      { to: '/dashboard', text: 'Dashboard', Icon: IconDashboard },
      { to: '/schedule', text: 'Schedule', Icon: IconSchedule },
      { to: '/jobs', text: 'Jobs', Icon: IconJobs },
    ],
  },
  {
    label: 'Stock',
    items: [
      { to: '/inventory', text: 'Inventory', Icon: IconInventory },
      { to: '/orders', text: 'Supplier orders', Icon: IconOrders },
      { to: '/templates', text: 'Build sheets', Icon: IconBuildSheets },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/expenses', text: 'Expenses', Icon: IconExpenses },
      { to: '/pnl', text: 'Profit and loss', Icon: IconMoney },
      { to: '/settings', text: 'Settings', Icon: IconSettings },
    ],
  },
]

// The top bar says where you are. Deriving it from the route means no page had
// to change to gain a title.
//
// Subtitles are operational labels, not explanations. They name the columns
// the page is about, so the bar tells you what you can read here rather than
// selling you the feature.
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

export default function AppShell({ children }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { error: settingsError, reload: reloadSettings } = useSettings()

  const [title, subtitle] = TITLES[pathname]
    || TITLES[`/${pathname.split('/')[1] || ''}`]
    || ['Water Base', '']

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-head">
          <img className="rail-mark" src={emblem} alt="" width="34" height="34" />
          <span className="rail-wordmark">
            Water Base
            <span>Michigan Water Pros</span>
          </span>
        </div>

        <nav className="rail-nav">
          {GROUPS.map(group => (
            <div key={group.label}>
              <div className="rail-group">{group.label}</div>
              {group.items.map(({ to, text, Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => isActive ? 'rail-item on' : 'rail-item'}
                >
                  <Icon />
                  {text}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="rail-foot">
          <button type="button" className="btn-signout" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-titles">
            <h1 className="page-title">{title}</h1>
            {subtitle && <p className="page-sub">{subtitle}</p>}
          </div>
        </header>

        {settingsError && (
          <div className="shell-banner" role="alert">
            <span>Settings could not be loaded, so some dropdowns will be empty. {settingsError}</span>
            <button type="button" className="tpl-link" onClick={reloadSettings}>Try again</button>
          </div>
        )}

        <main className="canvas">
          {children}
        </main>
      </div>
    </div>
  )
}
