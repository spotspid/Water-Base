import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useSettings } from '../lib/settings'
import './AppShell.css'

export default function AppShell({ children }) {
  const navigate = useNavigate()
  const { error: settingsError, reload: reloadSettings } = useSettings()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="shell">
      <header className="shell-header">
        <span className="shell-brand">Water Base</span>
        <nav className="shell-nav">
          <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Dashboard
          </NavLink>
          <NavLink to="/jobs" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Jobs
          </NavLink>
          <NavLink to="/schedule" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Schedule
          </NavLink>
          <NavLink to="/inventory" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Inventory
          </NavLink>
          <NavLink to="/templates" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Templates
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Settings
          </NavLink>
        </nav>
        <button className="btn-signout" onClick={handleSignOut}>Sign out</button>
      </header>
      {settingsError && (
        <div className="shell-banner" role="alert">
          <span>Settings could not be loaded, so some dropdowns will be empty. {settingsError}</span>
          <button type="button" className="tpl-link" onClick={reloadSettings}>Try again</button>
        </div>
      )}
      <main className="shell-main">
        {children}
      </main>
    </div>
  )
}
