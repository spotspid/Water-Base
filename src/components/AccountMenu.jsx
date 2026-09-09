import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { ACCOUNT_ITEMS } from '../lib/navigation'

// Who is signed in, what they can configure, and the way out.
//
// Settings lives here rather than in the bar because it is not a destination
// you visit during a day's work, it is the configuration behind the pages that
// are. Putting it under Money, which is where it used to sit, said it was a
// number.

// "Steve Burgess" to SB, "davidcvolpe@gmail.com" to DA. Falls back to a dot
// rather than to empty, so the button is never a blank circle.
function initialsOf(email) {
  const name = String(email || '').split('@')[0]
  const parts = name.split(/[.\-_+]/).filter(Boolean)

  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  if (parts.length === 1 && parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase()

  return '·'
}

export default function AccountMenu({ open, onToggle, onClose }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef(null)

  useEffect(() => {
    let live = true

    // The address is a nicety. If it cannot be read the menu still works, so
    // this failure is swallowed on purpose rather than shown.
    supabase.auth.getUser()
      .then(({ data }) => { if (live) setEmail(data?.user?.email || '') })
      .catch(() => { if (live) setEmail('') })

    return () => { live = false }
  }, [])

  async function handleSignOut() {
    setSigningOut(true)
    setError('')

    const { error: err } = await attempt(
      () => supabase.auth.signOut(),
      'You could not be signed out.',
    )

    setSigningOut(false)

    // Staying put with the reason on screen beats a half signed out session
    // that looks fine until the next request fails.
    if (err) {
      setError(err)
      return
    }

    onClose()
    navigate('/login')
  }

  function handleKeyDown(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onClose()
  }

  function handleBlur(event) {
    const next = event.relatedTarget
    if (next && event.currentTarget.contains(next)) return
    if (!signingOut) onClose()
  }

  return (
    <div className="nav-account" onBlur={handleBlur} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={`nav-avatar${open ? ' nav-avatar-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={email ? `Account, signed in as ${email}` : 'Account'}
        onClick={onToggle}
      >
        {initialsOf(email)}
      </button>

      {open && (
        <div className="nav-panel nav-panel-right" ref={panelRef} role="menu">
          <div className="nav-whoami">
            <span className="nav-whoami-label">Signed in as</span>
            <span className="nav-whoami-email">{email || 'this device'}</span>
          </div>

          {ACCOUNT_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              role="menuitem"
              className={({ isActive }) => (isActive ? 'nav-option nav-option-on' : 'nav-option')}
              onClick={onClose}
            >
              <span className="nav-option-text">
                <span className="nav-option-name">{item.text}</span>
                <span className="nav-option-hint">{item.hint}</span>
              </span>
            </NavLink>
          ))}

          {error && <p className="nav-account-error" role="alert">{error}</p>}

          <button
            type="button"
            className="nav-signout"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  )
}
