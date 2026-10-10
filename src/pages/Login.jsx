import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import wordmark from '../assets/wordmark.png'
import './Login.css'

function IconMail() {
  return (
    <svg
      className="field-icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2" y="4" width="16" height="12" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M2 7l8 5 8-5" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  )
}

function IconLock() {
  return (
    <svg
      className="field-icon"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="9" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="10" cy="13" r="1" fill="currentColor" />
    </svg>
  )
}

// Starting a password reset, which until now was the one part of the flow
// that did not exist.
//
// AuthCallback has handled recovery links since it was written: it parses the
// link, asks for a new password and saves it. Nothing ever sent the link, so
// the whole machine was unreachable and the only way back into an account was
// somebody else resetting it.
//
// It cost a sale on 2026-10-10. David was away from his saved password, found
// no way to sign in, and sent a customer agreement straight from DocuSeal
// instead, which arrives in Water Base as a signature matching no job.
export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleReset() {
    setError('')
    setSent(false)

    const address = email.trim()

    if (!address) {
      setError('Enter your email address first, then choose Forgot password.')
      return
    }

    setSending(true)

    // Back to the same callback the magic links use, which already knows what
    // to do with a recovery link.
    const { error: resetError } = await attempt(
      () => supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/auth/callback`,
      }),
      'The reset email could not be sent.',
    )

    setSending(false)

    if (resetError) {
      setError(resetError)
      return
    }

    // Said the same way whether or not the address has an account. Telling a
    // stranger which addresses exist is how an account list leaks.
    setSent(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    setLoading(false)

    if (authError) {
      setError(authError.message)
    } else {
      navigate('/dashboard')
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-mark">
          <img className="login-wordmark" src={wordmark} alt="Water Base" width="232" height="29" />
        </h1>
        <p className="login-subheading">Operations platform</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="email">Email</label>
            <div className="field-wrap">
              <IconMail />
              <input
                id="email"
                type="text"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="field-wrap">
              <IconLock />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {error && <p className="login-error" role="alert">{error}</p>}

          {sent && (
            <p className="login-sent" role="status">
              If that address has an account, a reset link is on its way. It works for
              one hour. Check the spam folder if it is not there in a minute.
            </p>
          )}

          <button type="submit" className="btn-signin" disabled={loading || sending}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>

          <button
            type="button"
            className="btn-forgot"
            onClick={handleReset}
            disabled={loading || sending}
          >
            {sending ? 'Sending...' : 'Forgot password'}
          </button>
        </form>
      </div>
    </div>
  )
}
