import { formatShortDate } from '../lib/schedule'

// What the reservation layer says about putting this job on the board.
//
// This is a warning and never a refusal. A shortfall on the 9th is routinely
// fixed by a delivery on the 8th, and the person scheduling usually knows
// that before the software does. So it reports precisely which part is short,
// by how much, and which other jobs are holding it, then gets out of the way.
export default function ScheduleConflicts({ conflicts, checking, error, onRetry }) {
  if (checking) {
    return <p className="inv-state">Checking parts availability...</p>
  }

  if (error) {
    return (
      <div className="inv-error-box" role="alert">
        <p className="inv-error-title">Parts availability could not be checked.</p>
        <p className="inv-error-detail">{error}</p>
        <p className="inv-error-hint">
          The job can still be scheduled. This check is a warning, so a failure here
          does not stop the booking, it only means it is unchecked.
        </p>
        {onRetry && (
          <button type="button" className="btn-cancel" onClick={onRetry}>Check again</button>
        )}
      </div>
    )
  }

  if (!Array.isArray(conflicts)) return null

  if (conflicts.length === 0) {
    return (
      <p className="sch-clear" role="status">
        Every part this job needs is on the shelf and promised to nobody else.
      </p>
    )
  }

  // A shortfall has two causes that read very differently to the person
  // scheduling: other jobs hold the stock, or there simply is not enough on
  // the shelf. Saying "promised to other jobs" when nothing competes sends
  // someone looking for a job that does not exist.
  const contested = conflicts.some(c =>
    Array.isArray(c.competing_jobs) && c.competing_jobs.length > 0)

  return (
    <section className="sch-conflicts" role="status">
      <h3 className="sch-conflicts-title">
        {conflicts.length === 1
          ? `1 part is short${contested ? ', and other jobs have promised it' : ''}`
          : `${conflicts.length} parts are short${contested ? ', and other jobs have promised them' : ''}`}
      </h3>

      <p className="sch-conflicts-lead">
        This does not stop the booking. It means that if nothing is ordered, the work
        below cannot all be completed from current stock.
      </p>

      <ul className="sch-conflict-list">
        {conflicts.map(row => (
          <li key={row.item_id} className="sch-conflict">
            <p className="sch-conflict-head">
              <span className="sch-conflict-name">{row.item_name}</span>
              {row.sku && <span className="sch-conflict-sku">{row.sku}</span>}
              <span className="sch-conflict-short">
                short {row.shortfall}
              </span>
            </p>

            <p className="sch-conflict-math">
              Needs {row.required}. {row.on_hand} on hand, {row.committed_other} already
              promised to other jobs, leaving {row.available_other} for this one.
            </p>

            {Array.isArray(row.competing_jobs) && row.competing_jobs.length === 0 && (
              <p className="sch-conflict-jobs">
                No other job is holding this. There is simply not enough on the shelf.
              </p>
            )}

            {Array.isArray(row.competing_jobs) && row.competing_jobs.length > 0 && (
              <p className="sch-conflict-jobs">
                Held by{' '}
                {row.competing_jobs.map((other, i) => (
                  <span key={`${other.job_id}-${i}`}>
                    {i > 0 && ', '}
                    {other.customer_name}
                    {' '}
                    <span className="sch-conflict-qty">
                      ({other.quantity}
                      {other.scheduled_date ? `, ${formatShortDate(other.scheduled_date)}` : ', no date'})
                    </span>
                  </span>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
