import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt, attemptRows } from '../lib/errors'
import { isWorkOrderOut } from '../lib/agreements'
import { describeStatusShift } from '../lib/jobActions'
import { isKnownAmount } from '../lib/profit'
import { useInstallerPay } from '../lib/useInstallerPay'
import CrewPayFields from './CrewPayFields'
import { gapsSentence } from '../lib/workOrder'
import './Agreement.css'

// Crew, pay and job number, saved from the job itself.
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
  // rate follows the crew box as it changes rather than after a save.
  const { suggestion } = useInstallerPay({
    templateId: job.template_id,
    roType: job.ro_type,
    installerId: draft.installer_id,
  })

  const crewDirty = draft.installer_id !== saved.installer_id || draft.helper_id !== saved.helper_id
  const detailsDirty = draft.payout_amount !== saved.payout_amount
  const dirty = crewDirty || detailsDirty

  // The status section holds "Mark installed", which must not run over
  // unsaved crew or pay, so it needs to know.
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  function change(e) {
    const { name, value } = e.target
    setDraft(d => ({ ...d, [name]: value }))
    setNotice('')
    setError('')
  }

  function problem() {
    if (draft.payout_amount !== '') {
      const pay = Number(draft.payout_amount)
      if (!Number.isFinite(pay) || pay < 0) return 'Installer pay must be zero or more, or left blank.'
    }
    if (draft.installer_id && draft.installer_id === draft.helper_id) {
      return 'The installer and the helper cannot be the same person.'
    }
    return ''
  }

  async function save() {
    const reason = problem()
    if (reason) { setError(reason); return }

    setBusy(true)
    setError('')
    setNotice('')
    let conflicts = 0
    // schedule_job decides sold or scheduled from the date. The date is
    // passed back unchanged, so this only moves when the status and the date
    // already disagreed, and then it is said rather than hidden.
    let status = job.status

    if (crewDirty) {
      const { data, error: err } = await attempt(
        () => supabase.rpc('schedule_job', {
          p_job_id: job.id,
          p_scheduled_date: job.scheduled_date || null,
          p_time_window: job.time_window || null,
          p_installer_id: draft.installer_id || null,
          p_helper_id: draft.helper_id || null,
          p_set_crew: true,
        }),
        'The crew could not be saved.',
      )

      if (err) {
        setBusy(false)
        setError(err)
        onChanged()
        return
      }
      conflicts = Number(data?.conflict_count) || 0
      status = data?.status || job.status
    }

    if (detailsDirty) {
      const { error: err } = await attemptRows(
        () => supabase.from('jobs').update({
          payout_amount: draft.payout_amount === '' ? null : Number(draft.payout_amount),
        }).eq('id', job.id),
        'The installer pay could not be saved.',
      )

      if (err) {
        setBusy(false)
        // Say exactly what landed. A half save reported as a failure invites
        // somebody to redo the half that already worked.
        setError(crewDirty
          ? `The crew was saved, but the pay was not. ${err}`
          : err)
        onChanged()
        return
      }
    }

    setBusy(false)
    const next = { ...draft }
    setDraft(next)
    setSaved(next)
    setNotice(describe(next, conflicts, status))
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
          <h3>Crew, pay and invoice number</h3>
          <p className="agr-sub">
            What the work order is built from. Saved here, it counts everywhere: the
            schedule, the dashboard and the send button all read the same values.
          </p>
        </div>
      </div>

      <CrewPayFields
        draft={draft}
        onChange={change}
        onDraft={setDraft}
        busy={busy}
        installers={installers}
        loadingCrew={loadingCrew}
        suggestion={suggestion}
        invoiceNumber={job.invoice_number}
        onEditInvoice={onEditInvoice}
      />

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="set-notice" role="status">{notice}</p>}

      <div className="agr-actions">
        <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={save}>
          {busy ? 'Saving...' : 'Save crew and pay'}
        </button>
        {dirty && !busy && (
          <button type="button" className="btn-cancel" onClick={() => { setDraft(saved); setError('') }}>
            Undo
          </button>
        )}
      </div>
    </section>
  )
}
