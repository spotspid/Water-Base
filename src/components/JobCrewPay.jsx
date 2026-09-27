import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt, attemptRows } from '../lib/errors'
import { isWorkOrderOut } from '../lib/agreements'
import { describeStatusShift } from '../lib/jobActions'
import { isKnownAmount } from '../lib/profit'
import { payoutForBox } from '../lib/installRates'
import { useInstallerPay } from '../lib/useInstallerPay'
import CrewPayFields from './CrewPayFields'
import { gapsSentence } from '../lib/workOrder'
import './Agreement.css'

// Crew and pay, saved as they are changed.
//
// There is no save button. Picking an installer writes it, and the pay writes
// itself when the typing stops, because a panel with a button people did not
// press is a panel full of changes that never happened: the work order sat
// refusing to send while the box above it showed the crew it needed.
//
// Every write says what it did, the message clears itself after a few seconds,
// and a refusal puts the box back to what the job actually holds.
//
// These are three of the things a work order refuses to go without, and until
// this existed none of them could be committed from the job. Installer and pay
// sat in the status section feeding only "Mark installed", so a payout could be
// typed and never saved, and the only way to assign a crew was to leave for the
// schedule. The job number could not be set anywhere after the job was written.
//
// The crew goes through schedule_job rather than a plain update, because that
// is where the roster rules live: nobody switched off in Settings can be given
// new work, and the installer cannot also be the helper. The date and window
// are passed back unchanged, so saving a crew never moves a booking.
//
// Who collects the balance moved to the payments panel and the valve type to
// the System section, where each sits beside what it belongs to rather than
// beside the first panel that could save.

function baselineOf(job) {
  return {
    installer_id: job.installer_id || '',
    helper_id: job.helper_id || '',
    // An empty box means no payout is recorded, and that is what job_margin
    // now reports rather than a zero. A stored zero is shown as a zero,
    // because somebody chose it.
    payout_amount: isKnownAmount(job.installer_pay) ? String(job.installer_pay) : '',
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export default function JobCrewPay({
  job, installers, loadingCrew, onChanged, onDirtyChange, onEditInvoice,
}) {
  const incoming = baselineOf(job)
  const incomingKey = JSON.stringify(incoming)
  const [saved, setSaved] = useState(incoming)
  const [draft, setDraft] = useState(incoming)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // A job that already carries a payout starts touched: the figure on it was
  // somebody's decision and reopening the drawer is not a reason to revisit
  // it. Anything else follows the rate until a person types over it.
  const [payTouched, setPayTouched] = useState(isKnownAmount(job.installer_pay))

  // The job reloads after every action in the modal. Follow the new values,
  // unless something has been typed and not saved, which is never worth
  // throwing away without being asked.
  useEffect(() => {
    const next = JSON.parse(incomingKey)
    if (same(next, saved)) return
    if (same(draft, saved)) setDraft(next)
    setSaved(next)
  }, [incomingKey, saved, draft])

  // Asked of the database from the draft rather than the saved row, so the
  // rate follows the crew box as it changes rather than after a save. With no
  // installer picked it answers with the card rate, which is what whoever ends
  // up doing the job starts on, so the box is never blank on a job that has a
  // build sheet.
  const { suggestion } = useInstallerPay({
    templateId: job.template_id,
    roType: job.ro_type,
    installerId: draft.installer_id,
  })

  // The box holds the rate until somebody types their own figure. Changing the
  // installer moves it; typing in it stops it moving for good.
  useEffect(() => {
    setDraft(d => {
      const next = payoutForBox({
        current: d.payout_amount, suggestion, touched: payTouched,
      })
      return next === d.payout_amount ? d : { ...d, payout_amount: next }
    })
  }, [suggestion, payTouched])

  // Mark installed waits only while a save is actually in flight now. There
  // is no other unsaved state to wait for: every change writes itself.
  useEffect(() => { onDirtyChange?.(busy) }, [busy, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  // The confirmation clears itself. A panel that saves on its own has to say
  // so, and a message that stays forever stops being read.
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  // A crew box is a choice between names, so it saves the moment it changes.
  // The pay box is typed, so it saves when the typing stops: on the way out of
  // the box or on Enter. Saving per keystroke would write four rows on the way
  // to 4000.
  function change(e) {
    const { name, value } = e.target

    setError('')

    if (name === 'payout_amount') {
      // Typing in the pay box makes the figure theirs. The rate stops
      // following and becomes something to compare against instead.
      setPayTouched(true)
      setDraft(d => ({ ...d, payout_amount: value }))
      return
    }

    const next = { ...draft, [name]: value }
    setDraft(next)
    saveCrew(next)
  }

  // Leaving the box, or Enter. Nothing is written when the figure has not
  // moved, so tabbing through the panel saves nothing.
  function commitPay() {
    if (!payTouched || draft.payout_amount === saved.payout_amount) return
    savePay(draft.payout_amount)
  }

  // Pressing the rate button is somebody choosing that figure, so it is theirs
  // and it saves immediately rather than waiting for a blur that may not come.
  function usePay(next) {
    setPayTouched(true)
    setDraft(d => ({ ...d, payout_amount: next }))
    savePay(next)
  }

  /**
   * The crew, written the moment it is picked.
   *
   * schedule_job rather than a plain update, because that is where the roster
   * rules live: nobody switched off in Settings can be given new work, and the
   * installer cannot also be the helper. The date and window go back
   * unchanged, so saving a crew never moves a booking.
   *
   * A refusal puts the boxes back to what the job actually holds. The panel
   * showing a name the database rejected is how somebody ends up believing a
   * job has a crew it has not.
   */
  async function saveCrew(next) {
    if (next.installer_id && next.installer_id === next.helper_id) {
      setDraft(saved)
      setError('The installer and the helper cannot be the same person.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    const { data, error: err } = await attempt(
      () => supabase.rpc('schedule_job', {
        p_job_id: job.id,
        p_scheduled_date: job.scheduled_date || null,
        p_time_window: job.time_window || null,
        p_installer_id: next.installer_id || null,
        p_helper_id: next.helper_id || null,
        p_set_crew: true,
      }),
      'The crew could not be saved.',
    )

    setBusy(false)

    if (err) {
      setDraft(saved)
      setError(`${err} The crew is unchanged.`)
      onChanged()
      return
    }

    setSaved(next)
    setNotice(describe(next, Number(data?.conflict_count) || 0, data?.status || job.status))
    onChanged()
  }

  /**
   * The pay, written when the typing stops.
   *
   * A refusal puts the figure back to what the job holds, for the same reason
   * the crew goes back: a box showing 650 on a job that still says nothing is
   * a worse state than one that admits the save failed.
   */
  async function savePay(value) {
    const blank = String(value).trim() === ''
    const amount = Number(value)

    if (!blank && (!Number.isFinite(amount) || amount < 0)) {
      setDraft(d => ({ ...d, payout_amount: saved.payout_amount }))
      setError('Installer pay must be zero or more, or left blank. The old figure stands.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')

    const { error: err } = await attemptRows(
      () => supabase.from('jobs').update({
        payout_amount: blank ? null : amount,
      }).eq('id', job.id),
      'The installer pay could not be saved.',
    )

    setBusy(false)

    if (err) {
      setDraft(d => ({ ...d, payout_amount: saved.payout_amount }))
      setError(`${err} The pay is unchanged.`)
      onChanged()
      return
    }

    const next = { ...draft, payout_amount: blank ? '' : String(value) }
    setDraft(next)
    setSaved(next)
    setNotice(describe(next, 0, job.status))
    onChanged()
  }

  // What saving did to the work order, read from the same rule the send
  // button uses, so this note and the button can never disagree.
  function describe(next, conflicts, status) {
    const crew = installers.find(i => i.id === next.installer_id)
    const after = {
      ...job,
      installer_id: next.installer_id || null,
      installer_email: crew?.email || null,
      installer_pay: next.payout_amount === '' ? null : Number(next.payout_amount),
    }
    const short = conflicts > 0
      ? ` ${conflicts} ${conflicts === 1 ? 'part is' : 'parts are'} short for this date.`
      : ''
    const lead = `Saved.${describeStatusShift(job.status, status)}${short}`

    if (isWorkOrderOut(job) || job.work_order_status === 'completed') {
      return `${lead} The work order already sent still shows the old values, so resend it if this matters.`
    }
    const needs = gapsSentence(after)
    return needs ? `${lead} The work order still ${needs.charAt(0).toLowerCase()}${needs.slice(1)}.`
      : `${lead} The work order can be sent now.`
  }

  return (
    <section className="agr-panel">
      <div className="agr-head">
        <div>
          <h3>Crew and pay</h3>
          <p className="agr-sub">Who is doing it, and what they are paid.</p>
        </div>
      </div>

      <CrewPayFields
        draft={draft}
        onChange={change}
        onCommitPay={commitPay}
        onUsePay={usePay}
        busy={busy}
        installers={installers}
        loadingCrew={loadingCrew}
        suggestion={suggestion}
        payPending={!payTouched && draft.payout_amount !== ''}
        invoiceNumber={job.invoice_number}
        onEditInvoice={onEditInvoice}
      />

      {/* There is no save button, so the panel has to say what it did. Busy
          while it writes, then what changed, then quiet again. A failure stays
          until something else happens, because it is the one message somebody
          has to read. */}
      {busy && <p className="agr-sub" role="status">Saving...</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!busy && !error && notice && <p className="set-notice" role="status">{notice}</p>}
    </section>
  )
}
