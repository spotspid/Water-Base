import { useLocation } from 'react-router-dom'
import { useSettings } from '../lib/settings'
import { titleFor } from '../lib/navigation'
import TopNav from './TopNav'
import './AppShell.css'

// The frame every signed in page sits in: the bar, a page heading, and the
// canvas.
//
// The heading is derived from the route, so no page had to change to gain one.
// It used to be duplicated, once in a shell bar and again inside each page,
// which put "Dashboard" on screen twice in two sizes. The shell owns it now
// and the pages render their own controls beside it.
export default function AppShell({ children, actions, subtitle }) {
  const { pathname } = useLocation()
  const { error: settingsError, reload: reloadSettings } = useSettings()

  // The route knows what the page is called. A page may still know something
  // the route cannot, such as which month is on screen, so it can say so.
  const [title, routeSubtitle] = titleFor(pathname)
  const sub = subtitle === undefined ? routeSubtitle : subtitle

  return (
    <div className="app">
      <TopNav />

      {settingsError && (
        <div className="shell-banner" role="alert">
          <span>
            Settings could not be loaded, so some dropdowns will be empty. {settingsError}
          </span>
          <button type="button" className="tpl-link" onClick={reloadSettings}>
            Try again
          </button>
        </div>
      )}

      <main className="canvas">
        <div className="page-head">
          <div className="page-head-text">
            <h1 className="page-title">{title}</h1>
            {sub && <p className="page-sub">{sub}</p>}
          </div>
          {actions && <div className="page-head-actions">{actions}</div>}
        </div>

        {children}
      </main>
    </div>
  )
}
