import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt, attemptRows } from '../lib/errors'
import { isWorkOrderOut } from '../lib/agreements'
import { describeStatusShift } from '../lib/jobActions'
import { useSettings, withCurrent } from '../lib/settings'
import { installerLabel } from '../lib/useInstallers'
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
// Who collects the balance lives here too. The work order has a box for the
// company and one for the subcontractor, and the X used to be hardcoded to
// the company, so an installer who took the payment signed a sheet saying he
// had not. Company is the default because that is what every sheet so far
// has said.
const COLLECTED_BY = [
  { value: 'company', label: 'The company' },
  { value: 'subcontractor', label: 'The subcontractor' },
]

function baselineOf(job) {
  const pay = Number(job.installer_pay)
  return {
    installer_id: job.installer_id || '',
    helper_id: job.helper_id || '',
    // job_margin reports an unpriced job as 0, and a work order treats 0 as no
    // payout, so both read as an empty box rather than a confident zero.
    payout_amount: Number.isFinite(pay) && pay > 0 ? String(job.installer_pay) : '',
    invoice_number: job.invoice_number || '',
    collected_by: job.collected_by === 'subcontractor' ? 'subcontractor' : 'company',
    // which control valve the build sheet takes; blank on an RO only job
    valve_type: job.valve_type || '',
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export default function JobCrewPay({ job, installers, loadingCrew, onChanged, onDirtyChange }) {
  const { valveTypes, loading: loadingSettings } = useSettings()
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

  const crewDirty = draft.installer_id !== saved.installer_id || draft.helper_id !== saved.helper_id
  const detailsDirty = draft.payout_amount !== saved.payout_amount
    || draft.invoice_number.trim() !== saved.invoice_number.trim()
    || draft.collected_by !== saved.collected_by
    || draft.valve_type !== saved.valve_type
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
    if (!COLLECTED_BY.some(c => c.value === draft.collected_by)) {
      return 'Pick who collects the balance.'
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
          invoice_number: draft.invoice_number.trim() || null,
          collected_by: draft.collected_by,
          valve_type: draft.valve_type || null,
        }).eq('id', job.id),
        'The pay and job details could not be saved.',
      )

      if (err) {
        setBusy(false)
        // Say exactly what landed. A half save reported as a failure invites
        // somebody to redo the half that already worked.
        setError(crewDirty
          ? `The crew was saved, but the pay and job details were not. ${err}`
          : err)
        onChanged()
        return
      }
    }

    setBusy(false)
    const next = { ...draft, invoice_number: draft.invoice_number.trim() }
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
      invoice_number: next.invoice_number || null,
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
          <h3>Crew, pay and job number</h3>
          <p className="agr-sub">
            What the work order is built from. Saved here, it counts everywhere: the
            schedule, the dashboard and the send button all read the same values.
          </p>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="crew_installer">Installer</label>
          <select id="crew_installer" name="installer_id" value={draft.installer_id}
            onChange={change} disabled={busy || loadingCrew}>
            <option value="">{loadingCrew ? 'Loading crew...' : 'Unassigned'}</option>
            {installers.map(i => (
              <option key={i.id} value={i.id} disabled={!i.active}>{installerLabel(i)}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="crew_helper">Helper <span className="optional">(optional)</span></label>
          <select id="crew_helper" name="helper_id" value={draft.helper_id}
            onChange={change} disabled={busy || loadingCrew}>
            <option value="">None</option>
            {installers.filter(i => i.id !== draft.installer_id).map(i => (
              <option key={i.id} value={i.id} disabled={!i.active}>{installerLabel(i)}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="crew_payout">Installer pay ($)</label>
          <input id="crew_payout" name="payout_amount" type="number" min="0" step="0.01"
            value={draft.payout_amount} onChange={change} disabled={busy} />
        </div>

        <div className="field">
          <label htmlFor="crew_invoice">Job number</label>
          <input id="crew_invoice" name="invoice_number" type="text"
            value={draft.invoice_number} onChange={change} disabled={busy}
            placeholder="MWP-0001" />
          <span className="field-hint">The invoice number. The work order will not send without it.</span>
        </div>

        <div className="field">
          <label htmlFor="crew_collected_by">Balance collected by</label>
          <select id="crew_collected_by" name="collected_by" value={draft.collected_by}
            onChange={change} disabled={busy}>
            {COLLECTED_BY.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <span className="field-hint">
            Who takes what is still owed on the day. Ticks one of the two collected by
            boxes on the work order.
          </span>
        </div>

        <div className="field">
          <label htmlFor="crew_valve_type">Valve type</label>
          <select id="crew_valve_type" name="valve_type" value={draft.valve_type}
            onChange={change} disabled={busy || loadingSettings}>
            <option value="">{loadingSettings ? 'Loading valve types...' : 'Not chosen'}</option>
            {withCurrent(valveTypes, draft.valve_type).map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <span className="field-hint">
            Which control valve goes on the truck. Printed on the work order and taken
            off the shelf when the job installs. RO only needs none.
          </span>
        </div>
      </div>

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
