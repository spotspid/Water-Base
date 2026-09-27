import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attemptRows } from '../lib/errors'
import { rateAmount, rateValue, hasSuggestion } from '../lib/installRates'

// Setting the pay on a job from the documents list.
//
// The list groups every blocked document under what it is waiting on, so a
// column of eight rows can all be waiting on a payout. Fixing them meant
// opening each job by its name, finding the crew panel, typing a figure and
// coming back, which is four moves for one number and the reason the backlog
// sat there.
//
// The figure is the same one the job drawer offers, from suggested_installer_pay,
// so the rate a job is paid does not depend on which screen it was set from.
// One press is the ordinary case. The box beside it is for the job that is
// worth something else, and there is no rate to press when the build sheet has
// no rate line, so then the box is the only way in.
export default function DocumentPayFix({ jobId, onFixed }) {
  const [rate, setRate] = useState(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true

    supabase.rpc('suggested_installer_pay', { p_job_id: jobId }).then(({ data, error: err }) => {
      if (!live) return
      // No rate is not a failure. The box still works, and the button simply
      // does not appear.
      setRate(err ? null : (Array.isArray(data) ? data[0] || null : data || null))
    })

    return () => { live = false }
  }, [jobId])

  async function save(value) {
    const amount = Number(value)

    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter the pay as a number, zero or more.')
      return
    }

    setBusy(true)
    setError('')

    const { error: err } = await attemptRows(
      () => supabase.from('jobs').update({ payout_amount: amount }).eq('id', jobId),
      'The pay could not be saved.',
    )

    setBusy(false)

    if (err) {
      setError(err)
      return
    }

    setTyped('')
    onFixed(amount)
  }

  return (
    <span className="doc-fix">
      {hasSuggestion(rate) && (
        <button type="button" className="btn-primary btn-small" disabled={busy}
          onClick={() => save(rateValue(rate))}>
          {busy ? 'Saving...' : `Pay ${rateAmount(rate)}`}
        </button>
      )}

      <input
        className="doc-fix-input"
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        placeholder="Other"
        aria-label="Installer pay for this job"
        value={typed}
        disabled={busy}
        onChange={e => { setTyped(e.target.value); setError('') }}
        onKeyDown={e => { if (e.key === 'Enter' && typed !== '') save(typed) }}
      />

      {typed !== '' && (
        <button type="button" className="btn-cancel btn-small" disabled={busy}
          onClick={() => save(typed)}>
          Save
        </button>
      )}

      {/* Whose rate it is, so a figure pressed in one click is still accounted
          for. Quiet, because the button above already carries the number. */}
      {rate?.reason && !error && <span className="doc-fix-note">{rate.reason}</span>}
      {error && <span className="doc-fix-note doc-reason">{error}</span>}
    </span>
  )
}
