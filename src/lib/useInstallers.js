import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { attempt } from './errors'

export function sortInstallers(rows) {
  return [...(rows || [])].sort((a, b) => {
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0)
    if (order !== 0) return order
    return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' })
  })
}

// The crew roster. activeOnly is what the assignment dropdowns want, since
// someone turned off should not pick up new work, while the settings editor
// wants every row so it can turn them back on.
export function useInstallers({ activeOnly = false } = {}) {
  const [installers, setInstallers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => {
        const query = supabase
          .from('installers')
          .select('id, name, phone, email, color, active, sort_order')
        return activeOnly ? query.eq('active', true) : query
      },
      'The installer roster could not be loaded.',
    )

    if (err) {
      setError(err)
      setInstallers([])
    } else {
      setInstallers(sortInstallers(data || []))
    }

    setLoading(false)
  }, [activeOnly])

  useEffect(() => { reload() }, [reload])

  return { installers, loading, error, reload }
}
