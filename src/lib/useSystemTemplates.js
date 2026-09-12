import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { attempt } from './errors'
import { sortTemplates } from './templates'

// Loads the system templates that used to be the hardcoded SYSTEM_TEMPLATES
// array. activeOnly is what the new job form wants, since an inactive
// template should not be sellable, while the Templates page wants them all.
//
// keepIds is for the edit form. A job can be sitting on a sheet that has since
// been deactivated, and an active only list would leave its select with
// nothing selected, which reads as "no sheet" and saves as a change nobody
// asked for. Naming the job's own sheet keeps it in the list without making it
// sellable anywhere else.
export function useSystemTemplates({ activeOnly = false, keepIds = [] } = {}) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // The array is rebuilt by the caller on every render, so the ids themselves
  // are the dependency rather than the array holding them.
  const keep = keepIds.filter(Boolean).join(',')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => {
        const query = supabase
          .from('system_templates')
          .select('id, label, default_price, active, sort_order, notes')

        if (!activeOnly) return query
        if (!keep) return query.eq('active', true)

        return query.or(`active.eq.true,id.in.(${keep})`)
      },
      'System templates could not be loaded.',
    )

    if (err) {
      setError(err)
      setTemplates([])
    } else {
      setTemplates(sortTemplates(data || []))
    }

    setLoading(false)
  }, [activeOnly, keep])

  useEffect(() => { reload() }, [reload])

  return { templates, loading, error, reload }
}
