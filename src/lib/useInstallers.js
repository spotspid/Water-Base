import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { attempt } from './errors'

export function sortInstallers(rows) {
  return [...(rows || [])].sort((a, b) => {
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0)
    if (order !== 0) return order
    return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' })
  })
}

// How a name reads in a dropdown. Somebody turned off still appears when a job
// already has them, so the label has to say why they cannot be picked again.
export function installerLabel(installer) {
  if (!installer) return ''
  const name = installer.name || 'Unnamed'
  return installer.active ? name : `${name} (inactive)`
}

/**
 * The crew roster.
 *
 * activeOnly is what the assignment dropdowns want, since someone turned off
 * should not pick up new work, while the settings editor wants every row so it
 * can turn them back on.
 *
 * keepIds is the exception that makes activeOnly safe. A job that already has
 * an installer keeps pointing at them after they are deactivated, and a select
 * whose value matches none of its options renders blank. That would show a
 * finished job as though nobody had done it, and anyone "fixing" the blank
 * would overwrite the record of who actually did the work. So whoever a job
 * already has stays in the list, labelled inactive and not selectable.
 */
export function useInstallers({ activeOnly = false, keepIds } = {}) {
  const [installers, setInstallers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // loading is for the first load only. The settings editor reloads after
  // every save, and flipping loading each time swapped the editor for a
  // loading line, taking any half typed row with it.
  const loadedRef = useRef(false)

  // A caller passing a fresh array literal every render would otherwise
  // reload the roster forever, so the dependency is the contents, not the array.
  const keepKey = [...new Set((keepIds || []).filter(Boolean))].sort().join(',')

  const reload = useCallback(async () => {
    if (!loadedRef.current) setLoading(true)
    setError('')

    // The whole roster, always. It is a handful of rows, and filtering here
    // rather than in the query is what lets keepIds work at all.
    const { data, error: err } = await attempt(
      () => supabase
        .from('installers')
        .select('id, name, phone, email, color, active, sort_order'),
      'The installer roster could not be loaded.',
    )

    if (err) {
      setError(err)
      setInstallers([])
    } else {
      const keep = new Set(keepKey ? keepKey.split(',') : [])
      const rows = (data || []).filter(
        row => !activeOnly || row.active || keep.has(row.id),
      )
      setInstallers(sortInstallers(rows))
      loadedRef.current = true
    }

    setLoading(false)
  }, [activeOnly, keepKey])

  useEffect(() => { reload() }, [reload])

  return { installers, loading, error, reload }
}
