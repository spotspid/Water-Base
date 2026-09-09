import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { GROUPS, groupForPath } from '../lib/navigation'
import {
  IconBuildSheets, IconDashboard, IconExpenses, IconInventory,
  IconDocuments, IconJobs, IconMoney, IconOrders, IconSchedule,
} from './NavIcons'
import NavMenu from './NavMenu'
import AccountMenu from './AccountMenu'
import emblem from '../assets/emblem.png'

// The bar itself, and the one piece of state the menus share: which one is
// open. Exactly one, ever. Two panels on screen at once is the tell of a nav
// assembled from independent dropdowns rather than built as a menu bar.
//
// The icons are attached here rather than in navigation.js so that file stays
// free of components and can be read by anything, including a plain Node
// script.
const ICONS = {
  '/dashboard': IconDashboard,
  '/schedule': IconSchedule,
  '/jobs': IconJobs,
  '/documents': IconDocuments,
  '/inventory': IconInventory,
  '/orders': IconOrders,
  '/templates': IconBuildSheets,
  '/expenses': IconExpenses,
  '/pnl': IconMoney,
}

const WITH_ICONS = GROUPS.map(group => ({
  ...group,
  items: group.items.map(item => ({ ...item, Icon: ICONS[item.to] })),
}))

export default function TopNav() {
  const { pathname } = useLocation()
  const [openId, setOpenId] = useState('')
  const [lifted, setLifted] = useState(false)
  const barRef = useRef(null)

  const currentGroup = groupForPath(pathname)

  const close = useCallback(() => setOpenId(''), [])

  // Arriving somewhere new with the old menu still hanging open looks broken,
  // and the panel would be covering the page you just asked for.
  useEffect(() => { close() }, [pathname, close])

  // Hover switches between menus, but only once one is already open. A bar
  // that opens at a passing cursor is hostile on the way to somewhere else.
  const handleHover = useCallback(id => {
    setOpenId(current => (current ? id : current))
  }, [])

  const toggle = useCallback(id => {
    setOpenId(current => (current === id ? '' : id))
  }, [])

  // A pointer down anywhere outside the bar closes whatever is open. Pointer
  // rather than click, so the menu is gone before the thing underneath reacts.
  useEffect(() => {
    if (!openId) return undefined

    function onPointerDown(event) {
      if (barRef.current?.contains(event.target)) return
      close()
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [openId, close])

  // The bar gains its shadow only once there is content behind it, so a short
  // page does not sit under a line that is separating it from nothing.
  useEffect(() => {
    function onScroll() { setLifted(window.scrollY > 4) }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`nav${lifted ? ' nav-lifted' : ''}`} ref={barRef}>
      <div className="nav-inner">
        <Link to="/dashboard" className="nav-brand" aria-label="Water Base, dashboard">
          <img className="nav-emblem" src={emblem} alt="" width="32" height="32" />
          <span className="nav-brand-text">
            Water Base
            <span className="nav-brand-sub">Michigan Water Pros</span>
          </span>
        </Link>

        <nav className="nav-groups" aria-label="Main">
          {WITH_ICONS.map(group => (
            <NavMenu
              key={group.id}
              group={group}
              open={openId === group.id}
              current={currentGroup === group.id}
              onOpen={setOpenId}
              onToggle={toggle}
              onHover={handleHover}
              onClose={close}
            />
          ))}
        </nav>

        <div className="nav-right">
          <Link to="/jobs/new" className="nav-cta">
            <span className="nav-cta-plus" aria-hidden="true">+</span>
            New job
          </Link>

          <AccountMenu
            open={openId === 'account'}
            onToggle={() => toggle('account')}
            onClose={close}
          />
        </div>
      </div>
    </header>
  )
}
