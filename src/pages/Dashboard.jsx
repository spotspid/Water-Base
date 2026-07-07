import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Dashboard.css'

export default function Dashboard() {
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <span className="dashboard-brand">Water Base</span>
        <button className="btn-signout" onClick={handleSignOut}>Sign out</button>
      </header>
      <main className="dashboard-main">
        <h1>Water Base</h1>
        <p>You are logged in. Dashboard coming soon.</p>
      </main>
    </div>
  )
}
