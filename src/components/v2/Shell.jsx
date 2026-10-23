import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import wordmark from '../../assets/wordmark-white.png'
import './Shell.css'

// The frame every rebuilt page sits in.
//
// A left sidebar, which is what the category does: Jobber, ServiceTitan and
// Housecall Pro all put navigation on the left, and the last two moved it
// there recently rather than starting there. ServiceTitan removed the option
// to switch back.
//
// Plus a thin bar across the top for the things that belong to no page:
// search, create, the account. That is where Housecall Pro landed when it
// moved its menu left, and the reason is that a sidebar holding both
// destinations and verbs is a sidebar holding two kinds of thing. Neither
// strip gets crowded this way, which is what matters when a dealer has
// fourteen items again.
//
// Provisional until somebody picks from the five drawn on the canvas. It is
// one component, so swapping the shape is one file.

const SECTIONS = [
  {
    title: 'Work',
    items: [
      { to: '/v2/quote', label: 'New quote', glyph: '▭' },
      { to: '/v2/jobs', label: 'Jobs', glyph: '▣' },
    ],
  },
]

export default function Shell({ title, actions, children }) {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  return (
    <div className="v2-shell">
      <header className="v2-top">
        <div className="v2-left">
          <button
            type="button" className="v2-burger" aria-expanded={open}
            aria-label={open ? 'Hide the menu' : 'Show the menu'}
            onClick={() => setOpen(!open)}
          >
            <span aria-hidden="true">&#9776;</span>
          </button>

          <Link to="/v2/jobs" className="v2-brand">
            <img src={wordmark} alt="Water Base" width="150" height="19" />
          </Link>
        </div>

        <div className="v2-search-wrap">
          <label htmlFor="v2-search" className="v2-hidden">Search</label>
          <input
            id="v2-search" type="search" className="v2-search"
            placeholder="Search customers, jobs, documents"
          />
        </div>

        <div className="v2-actions">
          <Link to="/v2/quote" className="v2-create">New quote</Link>
          <span className="v2-who" aria-hidden="true">MW</span>
        </div>
      </header>

      <div className="v2-body">
        <nav className={open ? 'v2-side v2-side-open' : 'v2-side'} aria-label="Main">
          {SECTIONS.map(section => (
            <div key={section.title} className="v2-group">
              <div className="v2-group-title">{section.title}</div>
              {section.items.map(item => (
                <Link
                  key={item.to} to={item.to}
                  className={pathname === item.to ? 'v2-nav v2-nav-on' : 'v2-nav'}
                  onClick={() => setOpen(false)}
                >
                  <span aria-hidden="true" className="v2-nav-glyph">{item.glyph}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}

          <p className="v2-side-foot">Michigan Water Pros</p>
        </nav>

        <main className="v2-main">
          <div className="v2-head">
            <h1>{title}</h1>
            {actions}
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}
