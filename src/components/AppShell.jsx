import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import {
  IconBuildSheets, IconDashboard, IconDrop, IconExpenses, IconInventory,
  IconJobs, IconMoney, IconSchedule, IconSettings,
} from './NavIcons'
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
const TITLES = {
  '/dashboard': ['Dashboard', 'Today at a glance'],
  '/schedule': ['Schedule', 'Who is going where, and what they need'],
  '/jobs': ['Jobs', 'Every job, and what it earned'],
  '/jobs/new': ['New job', 'Parts are claimed as soon as it is saved'],
  '/inventory': ['Inventory', 'On hand is added up from the ledger, never typed in'],
  '/templates': ['Build sheets', 'Pick the parts once, every job using it draws them'],
  '/expenses': ['Expenses', 'Everything that is not parts or installer pay'],
  '/pnl': ['Profit and loss', 'Revenue less parts, pay and expenses, by month'],
  '/settings': ['Settings', 'Lists, crew and agreements'],
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
          <span className="rail-mark"><IconDrop /></span>
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
