import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { attempt } from './errors'
import { sortTemplates } from './templates'

// Loads the system templates that used to be the hardcoded SYSTEM_TEMPLATES
// array. activeOnly is what the new job form wants, since an inactive
// template should not be sellable, while the Templates page wants them all.
export function useSystemTemplates({ activeOnly = false } = {}) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => {
        const query = supabase
          .from('system_templates')
          .select('id, label, default_price, active, sort_order, notes')
        return activeOnly ? query.eq('active', true) : query
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
  }, [activeOnly])

  useEffect(() => { reload() }, [reload])

  return { templates, loading, error, reload }
}
