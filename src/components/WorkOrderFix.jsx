import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt, attemptRows } from '../lib/errors'
import { useSettings, withCurrent } from '../lib/settings'

// Clearing a work order blocker from the list that names it.
//
// The readiness list tells somebody what is missing and where to go: the
// schedule for the install time, the edit form for the address. David read
// both, went to neither, and sent a photograph of the list instead, because
// two errands for two short answers is not a workflow. The answers are short
// enough to give here.
//
// Only these two. A crew, a payout and a job number already have boxes in this
// same drawer, and the parts choices are a build sheet decision rather than a
// value to type, so pointing at those is right.
export default function WorkOrderFix({ item, job, onChanged }) {
  const { timeWindows, loading: loadingWindows } = useSettings()
  const [address, setAddress] = useState(job.address || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function saveWindow(value) {
    if (!value) return

    setBusy(true)
    setError('')

    // schedule_job rather than a plain update: it owns the date, the window
    // and the reservations together, so setting a time here cannot leave the
    // calendar and the shelf disagreeing.
    const { error: err } = await attempt(
      () => supabase.rpc('schedule_job', {
        p_job_id: job.id,
        p_scheduled_date: job.scheduled_date || null,
        p_time_window: value,
        p_installer_id: job.installer_id || null,
        p_helper_id: job.helper_id || null,
        p_set_crew: false,
      }),
      'The install time could not be saved.',
    )

    setBusy(false)

    if (err) {
      setError(err)
      return
    }

    onChanged()
  }

  async function saveAddress() {
    const next = address.trim()

    if (!next) {
      setError('Type the street address first.')
      return
    }

    setBusy(true)
    setError('')

    const { error: err } = await attemptRows(
      () => supabase.from('jobs').update({ address: next }).eq('id', job.id),
      'The address could not be saved.',
    )

    setBusy(false)

    if (err) {
      setError(err)
      return
    }

    onChanged()
  }

  if (item.key === 'time') {
    return (
      <span className="agr-check-fix">
        <select
          aria-label="Install time"
          defaultValue=""
          disabled={busy || loadingWindows}
          onChange={e => saveWindow(e.target.value)}
        >
          <option value="">{loadingWindows ? 'Loading times...' : 'Pick a time...'}</option>
          {withCurrent(timeWindows || [], job.time_window).map(w => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
        {busy && <span className="agr-check-saving">Saving...</span>}
        {error && <span className="agr-check-error">{error}</span>}
      </span>
    )
  }

  if (item.key === 'address') {
    return (
      <span className="agr-check-fix">
        <input
          type="text"
          aria-label="Street address"
          placeholder={job.city ? `Street address in ${job.city}` : 'Street address'}
          value={address}
          disabled={busy}
          onChange={e => { setAddress(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveAddress() } }}
        />
        <button type="button" className="btn-cancel btn-small" disabled={busy} onClick={saveAddress}>
          {busy ? 'Saving...' : 'Save'}
        </button>
        {error && <span className="agr-check-error">{error}</span>}
      </span>
    )
  }

  return <span className="agr-check-value">{item.fix}</span>
}
