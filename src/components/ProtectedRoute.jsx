import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SettingsProvider } from '../lib/SettingsProvider'

export default function ProtectedRoute({ children }) {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return null

  if (!session) return <Navigate to="/login" replace />

  // settings load once here, so every protected page shares one copy
  return <SettingsProvider>{children}</SettingsProvider>
}
