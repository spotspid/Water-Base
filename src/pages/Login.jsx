import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
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

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

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

          <button type="submit" className="btn-signin" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
