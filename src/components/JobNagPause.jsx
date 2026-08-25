import { useState } from 'react'
import { pauseNag, resumeNag } from '../lib/agreements'
import {
  NAG_WINDOW_DAYS, SNOOZE_CHOICES, isBeingChased, isNagPaused, unsignedDocuments,
} from '../lib/nag'
import { formatLongDate } from '../lib/schedule'
import './Agreement.css'

// Pausing the morning reminder on one job.
//
// The rule itself has one stopping condition, a signature, and that is
// deliberate: a reminder you can argue with is a reminder nobody trusts. But a
// customer on holiday for a fortnight should not cost the channel a message
// every morning, so one job can be quietened for a set number of days without
// touching the rule that governs the rest.
//
// The pause is logged and posted, because a job that goes quiet with no record
// of why is exactly how a job gets forgotten.
export default function JobNagPause({ job, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const paused = isNagPaused(job)
  const chased = isBeingChased(job)
  const outstanding = unsignedDocuments(job)

  // Nothing outstanding and nothing scheduled means the sweep is not looking
  // at this job, so there is nothing here to switch off.
  if (!chased && !paused) return null
  if (outstanding.length === 0 && !paused) return null

  async function run(action, days) {
    setError('')
    setNotice('')
    setBusy(true)

    const { data, error: err } = action === 'pause'
      ? await pauseNag(job.id, days)
      : await resumeNag(job.id)

    setBusy(false)

    if (err) {
      setError(err)
      onChanged()
      return
    }

    setNotice(action === 'pause'
      ? `Paused until ${formatLongDate(String(data).slice(0, 10))}. The team sees that it was paused.`
      : 'Reminders are back on for this job.')
    onChanged()
  }

  return (
    <section className="agr-panel agr-pause">
      <div className="agr-head">
        <div>
          <h3>Morning Reminders</h3>
          <p className="agr-sub">
            {paused
              ? <>Paused until <strong>{formatLongDate(String(job.nag_snoozed_until).slice(0, 10))}</strong>. This job is not in the 8am message.</>
              : <>This job is in the 8am message every day until {outstanding.join(' and ')} {outstanding.length === 1 ? 'is' : 'are'} signed.</>}
          </p>
        </div>
      </div>

      {!paused && !chased && (
        <p className="agr-sub">
          It is more than {NAG_WINDOW_DAYS} days out, so nothing is being sent yet.
        </p>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="set-notice" role="status">{notice}</p>}

      <div className="agr-actions">
        {paused ? (
          <button type="button" className="btn-cancel" disabled={busy}
            onClick={() => run('resume')}>
            {busy ? 'Working...' : 'Start reminding me again'}
          </button>
        ) : (
          <>
            <span className="agr-pause-label">Pause for</span>
            {SNOOZE_CHOICES.map(days => (
              <button key={days} type="button" className="btn-cancel" disabled={busy}
                onClick={() => run('pause', days)}>
                {days} {days === 1 ? 'day' : 'days'}
              </button>
            ))}
          </>
        )}
      </div>

      <p className="agr-sub">
        Pausing hides this one job. Every other job carries on, and a signature
        ends the reminders for good.
      </p>
    </section>
  )
}
