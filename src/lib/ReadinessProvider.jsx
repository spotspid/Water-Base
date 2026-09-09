import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { attempt } from './errors'
import { readinessByJob } from './readiness'
import { EMPTY_READINESS, ReadinessContext } from './readinessContext'

// Readiness for the jobs currently on the schedule.
//
// Held in a context rather than passed down, because the card that shows the
// badge is rendered from four different places: the calendar, the day modal,
// the list and the unscheduled rail. Threading a map through all four would
// have meant four components changed to carry something none of them use.
//
// One call for the whole screen. The database function takes an array of job
// ids, so twenty jobs on a month view is one request rather than twenty.
export function ReadinessProvider({ jobIds, children }) {
  const [state, setState] = useState(EMPTY_READINESS)

  // The ids as one string, so a fresh array of the same jobs on every render
  // does not refetch. Sorted, because the calendar returns them in date order
  // and the same set arriving in a different order is still the same set.
  const key = useMemo(
    () => [...new Set((jobIds || []).filter(Boolean))].sort().join(','),
    [jobIds],
  )

  const load = useCallback(async () => {
    const ids = key ? key.split(',') : []

    if (ids.length === 0) {
      setState({ ...EMPTY_READINESS, reload: load })
      return
    }

    setState(s => ({ ...s, loading: true, error: '' }))

    const { data, error } = await attempt(
      () => supabase.rpc('job_schedule_readiness', { p_job_ids: ids }),
      'Parts readiness could not be checked.',
    )

    // On failure the map is emptied rather than left stale. A badge from the
    // last successful load would keep saying Ready about a shelf that has
    // moved since, and a wrong Ready is the one thing this must not print.
    setState({
      map: error ? {} : readinessByJob(data || []),
      error: error || '',
      loading: false,
      reload: load,
    })
  }, [key])

  useEffect(() => { load() }, [load])

  return (
    <ReadinessContext.Provider value={state}>
      {children}
    </ReadinessContext.Provider>
  )
}
