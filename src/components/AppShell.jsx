import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './AppShell.css'

export default function AppShell({ children }) {
  const navigate = useNavigate()

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
          <NavLink to="/inventory" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            Inventory
          </NavLink>
        </nav>
        <button className="btn-signout" onClick={handleSignOut}>Sign out</button>
      </header>
      <main className="shell-main">
        {children}
      </main>
    </div>
  )
}
