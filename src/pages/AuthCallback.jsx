import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './Login.css'
import './AuthCallback.css'

const MIN_PASSWORD = 8

function IconLock() {
  return (
    <svg
      className="field-icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="9" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="13" r="1" fill="currentColor" />
    </svg>
  )
}

// Supabase sends recovery and magic links here. Two shapes arrive:
// PKCE puts a code in the query string, implicit puts tokens in the hash.
// The client is configured with detectSessionInUrl, so the hash form is
// consumed automatically. We handle the code form and read the result.
function readLinkParams() {
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return {
    code: query.get('code'),
    type: query.get('type') || hash.get('type'),
    errorDescription: query.get('error_description') || hash.get('error_description'),
    errorCode: query.get('error_code') || hash.get('error_code'),
    hasTokens: Boolean(hash.get('access_token')),
  }
}

export default function AuthCallback() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('verifying')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false

    // fires PASSWORD_RECOVERY once the client has parsed a recovery link
    const { data: { subscription } } = supabase.auth.onAuthStateChange(event => {
      if (!cancelled && event === 'PASSWORD_RECOVERY') setPhase('recovery')
    })

    async function verify() {
      const link = readLinkParams()

      if (link.errorDescription) {
        if (cancelled) return
        setError(decodeURIComponent(link.errorDescription).replace(/\+/g, ' '))
        setPhase('error')
        return
      }

      if (!link.code && !link.hasTokens && !link.type) {
        if (cancelled) return
        setError('No sign in link was found in this address. Open the link from your email again.')
        setPhase('error')
        return
      }

      if (link.code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(link.code)
        if (cancelled) return
        if (exchangeError) {
          setError(exchangeError.message)
          setPhase('error')
          return
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession()
      if (cancelled) return

      if (sessionError || !data.session) {
        setError(sessionError?.message || 'This link is invalid or has already expired. Request a new one.')
        setPhase('error')
        return
      }

      if (link.type === 'recovery') {
        setPhase('recovery')
        return
      }

      navigate('/dashboard', { replace: true })
    }

    verify().catch(caught => {
      if (cancelled) return
      setError(caught?.message || 'Could not verify this link. Check your connection and try again.')
      setPhase('error')
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [navigate])

  const handleSetPassword = useCallback(async e => {
    e.preventDefault()

    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }

    setError('')
    setSaving(true)

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        setSaving(false)
        return
      }
      navigate('/dashboard', { replace: true })
    } catch (caught) {
      setError(caught?.message || 'Could not save the password. Check your connection and try again.')
      setSaving(false)
    }
  }, [password, confirm, navigate])

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo" aria-label="Water Base logo placeholder">
          <span className="login-logo-mark">WB</span>
        </div>

        {phase === 'verifying' && (
          <>
            <h1 className="login-heading">Water Base</h1>
            <p className="login-subheading">Checking your link...</p>
            <p className="auth-status">One moment while we verify this sign in link.</p>
          </>
        )}

        {phase === 'error' && (
          <>
            <h1 className="login-heading">Link problem</h1>
            <p className="login-subheading">We could not use that link.</p>
            <p className="login-error" role="alert">{error}</p>
            <p className="auth-note">
              Recovery and magic links can only be used once, and they expire.
            </p>
            <Link to="/login" className="auth-back">Back to sign in</Link>
          </>
        )}

        {phase === 'recovery' && (
          <>
            <h1 className="login-heading">Set a password</h1>
            <p className="login-subheading">Choose a new password for your account.</p>

            <form className="login-form" onSubmit={handleSetPassword} noValidate>
              <div className="field">
                <label htmlFor="password">New password</label>
                <div className="field-wrap">
                  <IconLock />
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="confirm">Confirm password</label>
                <div className="field-wrap">
                  <IconLock />
                  <input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    disabled={saving}
                  />
                </div>
              </div>

              {error && <p className="login-error" role="alert">{error}</p>}

              <button type="submit" className="btn-signin" disabled={saving}>
                {saving ? 'Saving...' : 'Save password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
