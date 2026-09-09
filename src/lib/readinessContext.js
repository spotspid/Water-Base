import { createContext, useContext } from 'react'
import { readinessOf } from './readiness'

// The context object and the hooks that read it. The provider itself lives in
// ReadinessProvider.jsx so each file exports one kind of thing and fast
// refresh keeps working, the same split as settings.js and SettingsProvider.

export const EMPTY_READINESS = { map: {}, error: '', loading: false, reload: () => {} }

export const ReadinessContext = createContext(EMPTY_READINESS)

/**
 * The badge for one job, or null when there is nothing to say.
 *
 * Null covers a job that is finished, a job the answer did not include, and a
 * request that failed. All three mean no badge, never a green one: a card that
 * says Ready because a request failed is the one way this feature could put a
 * van on the road without a tank in it.
 */
export function useJobReadiness(jobId) {
  const { map } = useContext(ReadinessContext)
  return readinessOf(map[jobId])
}

// Whether the readiness call itself is in trouble, so the page can say so once
// rather than every card going quiet with no explanation.
export function useReadinessStatus() {
  const { error, loading, reload } = useContext(ReadinessContext)
  return { error, loading, reload }
}
