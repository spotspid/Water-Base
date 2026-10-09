import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attemptRows } from '../lib/errors'
import { isKnownAmount } from '../lib/profit'
import { formatCurrency } from '../lib/inventory'

// Installer pay, correctable on an installed job.
//
// An installed job's crew is a record of what happened, so the crew and pay
// panel that assigns it is not shown. But the payout used to be unfixable
// short of reversing the install, which moved stock. The payout is just a
// figure on the row, so it is corrected on its own: the write is a plain
// update, not schedule_job, which refuses an installed job on purpose. The
// install guard in the database only constrains status and parts_deducted_at
// moving together, so correcting the pay moves no stock and rewrites no
// history. The profit figure recomputes from the new figure on the next load.
//
// Saves like the open-job panel: when the typing stops, on the way out of the
// box or on Enter, never per keystroke.
export default function JobInstalledPay({ job, onChanged }) {
  const incoming = isKnownAmount(job.installer_pay) ? String(job.installer_pay) : ''
  const [saved, setSaved] = useState(incoming)
  const [value, setValue] = useState(incoming)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // The job reloads after the save. Follow the new figure, unless something
  // has been typed and not saved, which is never worth throwing away without
  // being asked.
  useEffect(() => {
    if (value === saved && incoming !== saved) {
      setValue(incoming)
      setSaved(incoming)
    }
  }, [incoming, value, saved])

  // The confirmation clears itself. A panel that saves on its own has to say
  // so, and a message that stays forever stops being read.
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  // Nothing is written when the figure has not moved, so tabbing through the
  // box saves nothing. Blank means no payout is recorded, which the profit
  // reads as "pay not set" rather than as nothing. A refusal puts the box
  // back to what the job actually holds.
  async function commit() {
    if (value === saved) return

    const blank = String(value).trim() === ''
    const amount = Number(value)

    if (!blank && (!Number.isFinite(amount) || amount < 0)) {
      setValue(saved)
      setError('Installer pay must be zero or more, or left blank. The old figure stands.')
      return
    }

    setBusy(true)
    setError('')

    const { error: err } = await attemptRows(
      () => supabase.from('jobs').update({
        payout_amount: blank ? null : amount,
      }).eq('id', job.id),
      'The installer pay could not be saved.',
    )

    setBusy(false)

    if (err) {
      setValue(saved)
      setError(`${err} The pay is unchanged.`)
      onChanged()
      return
    }

    setSaved(value)
    setNotice(blank
      ? 'Saved. The pay is now blank, so the job reads as pay not set.'
      : `Saved. The installer pay is now ${formatCurrency(amount)}.`)
    onChanged()
  }

  return (
    <section className="agr-panel">
      <div className="agr-head">
        <div>
          <h3>Installer pay</h3>
          <p className="agr-sub">
            The crew on this job is a record of what happened and cannot be changed.
            The payout can: correcting it fixes the profit, and nothing in inventory moves.
          </p>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="installed_payout">Installer pay ($)</label>
          <input id="installed_payout" name="installed_payout" type="number" min="0" step="0.01"
            value={value}
            onChange={e => { setError(''); setValue(e.target.value) }}
            disabled={busy}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }} />
          <span className="field-hint">Blank means not set, which is not the same as zero.</span>
        </div>
      </div>

      {busy && <p className="agr-sub" role="status">Saving...</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!busy && !error && notice && <p className="set-notice" role="status">{notice}</p>}
    </section>
  )
}
