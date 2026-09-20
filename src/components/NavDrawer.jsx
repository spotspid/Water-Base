import { NavLink, Link } from 'react-router-dom'
import { NAV_GROUPS } from './navGroups'
import { iconFor } from './navIcon'

// The whole nav, as one drawer, for a screen too narrow to hold a menu bar.
//
// Four menus will not fit across a phone. Shrinking them ran the last one off
// the edge and under the avatar; letting the row scroll left "Setup" cut off
// mid word with nothing to say it could be swiped, which reads as a bug
// rather than as a control. So on a narrow screen the bar carries one button
// and the menus move inside it.
//
// Every group is open at once in here. A phone has the vertical room, and a
// drawer that makes somebody tap a group before they can see its items is two
// taps to reach a page that the desktop bar reaches in one.
//
// New quote comes with it. The bar drops that link at 860px to save room,
// which left the main thing anybody does on a phone with no button at all.
export default function NavDrawer({ open, currentGroup, onToggle, onClose }) {
  return (
    <div className="nav-burger-wrap">
      <button
        type="button"
        className={`nav-burger${open ? ' nav-burger-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={open ? 'Close the menu' : 'Open the menu'}
        onClick={onToggle}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="nav-burger-icon">
          {open ? (
            <path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor"
              strokeWidth="1.9" strokeLinecap="round" />
          ) : (
            <path d="M3 6h14M3 10h14M3 14h14" fill="none" stroke="currentColor"
              strokeWidth="1.9" strokeLinecap="round" />
          )}
        </svg>
      </button>

      {open && (
        <div className="nav-drawer" role="menu">
          <Link to="/jobs/new" className="nav-drawer-cta" onClick={onClose}>
            <span aria-hidden="true">+</span> New quote
          </Link>

          {NAV_GROUPS.map(group => (
            <section className="nav-drawer-group" key={group.id}>
              <h2 className={currentGroup === group.id
                ? 'nav-drawer-label nav-drawer-label-on'
                : 'nav-drawer-label'}>
                {group.label}
              </h2>

              {group.items.map(item => {
                const Icon = iconFor(item)
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    role="menuitem"
                    className={({ isActive }) => (isActive ? 'nav-option nav-option-on' : 'nav-option')}
                    onClick={onClose}
                  >
                    <span className="nav-option-icon" aria-hidden="true"><Icon /></span>
                    <span className="nav-option-text">
                      <span className="nav-option-name">{item.text}</span>
                      <span className="nav-option-hint">{item.hint}</span>
                    </span>
                  </NavLink>
                )
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
