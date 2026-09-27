import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attemptRows } from '../lib/errors'

// Who takes the balance on the day.
//
// The work order has a box for the company and one for the subcontractor, and
// the X used to be hardcoded to the company, so an installer who took the
// payment signed a sheet saying he had not. Company is the default because
// that is what every sheet so far has said.
//
// It sat in the crew and pay panel, which is where the first savable form
// happened to be. It is a fact about the money, so it lives with the payments
// now, under the balance it decides the collecting of.
//
// Saves on change rather than behind a button: it is one choice between two,
// and a dropdown that needs a save press beside it is a dropdown people leave
// half set.
const COLLECTED_BY = [
  { value: 'company', label: 'The company' },
  { value: 'subcontractor', label: 'The subcontractor' },
]

export default function CollectedBy({ job, onChanged }) {
  const stored = job.collected_by === 'subcontractor' ? 'subcontractor' : 'company'
  const [value, setValue] = useState(stored)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // The job reloads after anything else in the drawer saves. Follow it, so a
  // change made elsewhere is not overwritten by a stale box.
  useEffect(() => { setValue(stored) }, [stored])

  async function change(e) {
    const next = e.target.value
    const previous = value

    setValue(next)
    setBusy(true)
    setError('')
    setNotice('')

    const { error: err } = await attemptRows(
      () => supabase.from('jobs').update({ collected_by: next }).eq('id', job.id),
      'Who collects the balance could not be saved.',
    )

    setBusy(false)

    if (err) {
      setValue(previous)
      setError(err)
      return
    }

    setNotice(next === 'subcontractor'
      ? 'Saved. The work order will say the subcontractor collects.'
      : 'Saved. The work order will say the company collects.')
    onChanged()
  }

  return (
    <div className="field">
      <label htmlFor="collected_by">Balance collected by</label>
      <select id="collected_by" name="collected_by" value={value}
        onChange={change} disabled={busy}>
        {COLLECTED_BY.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <span className="field-hint">
        Ticks one of the two collected by boxes on the work order. Change it before the
        work order goes out, or resend it afterwards.
      </span>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="set-notice" role="status">{notice}</p>}
    </div>
  )
}
