import { useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'

// One dropdown in the top bar.
//
// The behaviour is the part that decides whether a nav feels built or
// generated, so all of it is here and none of it is left to chance:
//
//   click        opens, and clicking the same trigger closes again
//   hover        once any menu is open, moving across the bar switches to the
//                next one without a second click, the way a real menu bar
//                works. Hovering with everything closed does nothing, so the
//                bar does not fly open at a passing cursor.
//   escape       closes and puts focus back on the trigger, not on the body
//   tab away     closes, because a menu nobody is in should not be on screen
//   arrows       move through the items, home and end jump to the ends
//   route change closes, handled by the parent, since arriving somewhere new
//                with the old menu still hanging open looks broken
//
// The panel is not rendered at all when closed rather than hidden with CSS, so
// its links are out of the tab order without needing to be told.

export default function NavMenu({
  group, open, current, onOpen, onClose, onToggle, onHover,
}) {
  const triggerRef = useRef(null)
  const panelRef = useRef(null)

  // Focus the first item when opened by keyboard, so the menu is usable
  // without a mouse. Opening by click deliberately leaves focus on the
  // trigger: a pointer user has not asked to be moved anywhere.
  const focusFirst = useRef(false)

  useEffect(() => {
    if (!open || !focusFirst.current) return
    focusFirst.current = false
    const first = panelRef.current?.querySelector('a')
    if (first) first.focus()
  }, [open])

  function handleTriggerKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      focusFirst.current = true
      onOpen(group.id)
      return
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault()
      onClose()
    }
  }

  function handlePanelKeyDown(event) {
    const links = [...(panelRef.current?.querySelectorAll('a') || [])]
    if (links.length === 0) return

    const at = links.indexOf(document.activeElement)

    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      triggerRef.current?.focus()
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      links[(at + 1) % links.length].focus()
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      links[at <= 0 ? links.length - 1 : at - 1].focus()
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      links[0].focus()
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      links[links.length - 1].focus()
    }
  }

  // Closing on blur has to wait a tick, because focus lands on the body for a
  // moment between leaving one element and reaching the next. Reading it
  // immediately would close the menu on every internal arrow press.
  function handleBlur(event) {
    const next = event.relatedTarget
    if (next && event.currentTarget.contains(next)) return
    onClose()
  }

  return (
    <div
      className="nav-menu"
      onBlur={handleBlur}
      onMouseEnter={() => onHover(group.id)}
    >
      <button
        type="button"
        ref={triggerRef}
        className={`nav-trigger${open ? ' nav-trigger-open' : ''}${current ? ' nav-trigger-current' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => onToggle(group.id)}
        onKeyDown={handleTriggerKeyDown}
      >
        {group.label}
        <svg className="nav-caret" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor"
            strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="nav-panel" ref={panelRef} onKeyDown={handlePanelKeyDown} role="menu">
          {group.items.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              role="menuitem"
              className={({ isActive }) => (isActive ? 'nav-option nav-option-on' : 'nav-option')}
              onClick={onClose}
            >
              <span className="nav-option-icon" aria-hidden="true"><item.Icon /></span>
              <span className="nav-option-text">
                <span className="nav-option-name">{item.text}</span>
                <span className="nav-option-hint">{item.hint}</span>
              </span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}
