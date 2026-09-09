import { useReadinessStatus } from '../lib/readinessContext'

// Says once, at the top of the schedule, that the readiness badges are not
// there because the check failed.
//
// Without this the failure is invisible: every card simply has no badge, which
// looks identical to a board where nothing has been checked yet. Somebody
// would read an unbadged Thursday as nothing to worry about.
//
// A warning rather than an error box, because the schedule itself loaded fine
// and every date, crew and window on screen is still true. Only the parts
// answer is missing.
export default function ReadinessNotice() {
  const { error, reload } = useReadinessStatus()

  if (!error) return null

  return (
    <p className="form-warning sch-ready-notice" role="alert">
      {error} The dates and crews below are correct, but no card can say whether
      its parts are free.
      {' '}
      <button type="button" className="tpl-link" onClick={reload}>Try again</button>
    </p>
  )
}
