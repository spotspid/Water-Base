import { useState } from 'react'
import { CANCELLED_STATUS, QUOTED_STATUS } from '../lib/constants'
import { formatCurrency } from '../lib/inventory'
import {
  GROSS, PAY_UNSET, basisTag, canShowProfit, isKnownAmount, notCostedLabel,
  partsNote, profitNote,
} from '../lib/profit'
import { useInstallers } from '../lib/useInstallers'
import { crewLabel, formatLongDate } from '../lib/schedule'
import { metaLine } from '../lib/text'
import {
  changeStatus, markInstalled, revertInstall, setScheduledDate,
} from '../lib/jobActions'
import JobAgreement from './JobAgreement'
import JobWorkOrder from './JobWorkOrder'
import JobEarlierDocuments from './JobEarlierDocuments'
import JobPartsLedger from './JobPartsLedger'
import JobDeposits from './JobDeposits'
import JobNagPause from './JobNagPause'
import JobSiteConditions from './JobSiteConditions'
import JobCrewPay from './JobCrewPay'
import JobStatusActions from './JobStatusActions'
import JobParts from './JobParts'
import JobEditModal from './JobEditModal'
import JobSalesChecklist from './JobSalesChecklist'
import Modal from './Modal'

export default function JobDetailModal({ job, fixField = '', onClose, onChanged }) {
  const { installers, loading: loadingCrew } = useInstallers({
    activeOnly: true,
    keepIds: [job.installer_id, job.helper_id],
  })
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [ledgerKey, setLedgerKey] = useState(0)
  const [revertTo, setRevertTo] = useState('scheduled')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [crewDirty, setCrewDirty] = useState(false)
  // Opened straight into the edit form when the link named a field to fix, so
  // an alert that says "Faucet finish not chosen" lands on the faucet finish
  // rather than on the job that has one somewhere.
  const [editing, setEditing] = useState(Boolean(fixField))
  // Which field the edit form opens on. Starts as the one the link named, and
  // the checklist sets it when Choose is pressed on finish, RO type or payment.
  const [editFocus, setEditFocus] = useState(fixField)
  const [install, setInstall] = useState({
    // an install that happened today usually happened on the day it was
    // promised, so the date it was booked for is the sensible starting point
    install_date: job.install_date || job.scheduled_date || '',
  })
  // Sold and scheduled are decided by the date, so marking a job scheduled
  // from here asks for one. Prefilled from the booking if it already has one.
  const [schedule, setSchedule] = useState({
    scheduled_date: job.scheduled_date || '',
  })

  const installed = job.status === 'installed'
  const cancelled = job.status === CANCELLED_STATUS
  const open = !installed && !cancelled

  function handleInstallChange(e) {
    const { name, value } = e.target
    setInstall(f => ({ ...f, [name]: value }))
  }

  function handleScheduleChange(e) {
    const { name, value } = e.target
    setSchedule(f => ({ ...f, [name]: value }))
  }

  // Every button in the status section runs through here, so one busy flag
  // stops two of them firing at once and every outcome lands the same way.
  async function perform(work) {
    setActionError('')
    setNotice('')
    setBusy(true)

    const { error, message } = await work()

    setBusy(false)

    if (error) {
      setActionError(error)
      // the job may have moved under us, so pull fresh numbers either way
      onChanged()
      return
    }

    setNotice(message)
    setLedgerKey(k => k + 1)
    setConfirmCancel(false)
    onChanged()
  }

  function runMarkInstalled() {
    // The button is disabled while this is true, so reaching here means
    // something raced it. Refusing is cheaper than recording stale values.
    if (crewDirty) {
      setActionError('Save or undo the crew and pay changes above before marking this installed.')
      return
    }
    perform(() => markInstalled(job, install.install_date))
  }

  const subtitle = metaLine([
    job.system_template,
    job.city,
    job.invoice_number && `Invoice ${job.invoice_number}`,
  ])

  return (
    <Modal title={job.customer_name} subtitle={subtitle} onClose={onClose} wide>
      <div className="job-margin-grid">
        <div className="job-margin-cell">
          <span className="inv-stat-label">Sale Price</span>
          <span className="inv-stat-value">{formatCurrency(job.sale_price)}</span>
        </div>
        <div className="job-margin-cell job-margin-minus">
          <span className="inv-stat-label">Parts Cost</span>
          <span className="inv-stat-value">
            {job.parts_cost_effective == null
              ? <span className="cell-unset">not costed</span>
              : formatCurrency(job.parts_cost_effective)}
            {basisTag(job.parts_cost_basis) && (
              <span className="cell-basis">{basisTag(job.parts_cost_basis)}</span>
            )}
          </span>
        </div>
        <div className="job-margin-cell job-margin-minus">
          <span className="inv-stat-label">Installer pay</span>
          <span className="inv-stat-value">
            {isKnownAmount(job.installer_pay)
              ? formatCurrency(job.installer_pay)
              : <span className="cell-unset">{PAY_UNSET}</span>}
          </span>
        </div>
        <div className={Number(job.margin) < 0 ? 'job-margin-cell job-margin-total job-margin-bad' : 'job-margin-cell job-margin-total'}>
          <span className="inv-stat-label">{GROSS}</span>
          <span className="inv-stat-value">
            {canShowProfit(job.profit_basis) && job.margin != null ? (
              <>
                {formatCurrency(job.margin)}
                {job.margin_pct != null && (
                  <span className="job-margin-pct">{Number(job.margin_pct).toFixed(1)}%</span>
                )}
              </>
            ) : (
              <span className="cell-unset">{notCostedLabel(job.profit_basis)}</span>
            )}
          </span>
        </div>
      </div>

      {/* The parts sentence answers for the parts figure, the profit one for
          the profit figure, and they can now be waiting on different things:
          a fully costed parts list and a missing payout is an ordinary state
          for a job nobody has paid out on yet. */}
      <p className="inv-ledger-note">
        {partsNote(job.parts_cost_basis)} {profitNote(job.profit_basis)}
      </p>

      <div className="form-actions job-edit-row">
        <button type="button" className="btn-cancel" onClick={() => { setEditFocus(''); setEditing(true) }}>
          Edit job details
        </button>
      </div>

      {/* An installed job is dated by the day it happened, not by the day it
          was booked for. Walter Radu was written up after the fact with an
          install date and no booking, and "Not scheduled yet" on an installed
          job read as a job with no date at all. */}
      <p className="job-schedule-line">
        {installed
          ? (job.install_date
            ? `Installed on ${formatLongDate(job.install_date)}.`
            : 'Installed, but no install date was recorded.')
          : job.scheduled_date
            ? `Scheduled for ${formatLongDate(job.scheduled_date)}${job.time_window ? `, ${job.time_window}` : ''}.`
            : 'Not scheduled yet.'}
        {' '}
        {crewLabel(job) ? `Crew: ${crewLabel(job)}.` : 'No crew assigned.'}
        {' '}
        <a href="/schedule" className="tpl-link">Change the date on the schedule</a>
      </p>

      {!cancelled && <JobDeposits job={job} onChanged={onChanged} />}

      {!cancelled && <JobAgreement job={job} onChanged={onChanged} />}

      {/* Quoted and sold jobs: the questions asked in the house before the
          quote goes out, and still open on a sold job until it is booked. A
          job with any answer still Not sure yet cannot be given a date, a crew
          or an install (jobs_guard_unsure), so a sold job is where David
          answers them, and on a sold job they show amber. Once a job is
          booked every answer is settled, so the panel is not needed after. */}
      {(job.status === QUOTED_STATUS || job.status === 'sold') && (
        <JobSalesChecklist
          job={job}
          onChanged={onChanged}
          onFixJobField={field => { setEditFocus(field); setEditing(true) }}
        />
      )}

      {!cancelled && <JobSiteConditions job={job} onChanged={onChanged} />}

      {/* Beside the work order because it is three of the things the work
          order refuses to go without. Open jobs only: an installed job's crew
          and pay are a record, and schedule_job refuses to touch one. */}
      {open && (
        <JobCrewPay
          job={job}
          installers={installers}
          loadingCrew={loadingCrew}
          onChanged={onChanged}
          onDirtyChange={setCrewDirty}
        />
      )}

      {!cancelled && <JobWorkOrder job={job} onChanged={onChanged} />}

      <JobEarlierDocuments job={job} />

      {!cancelled && <JobNagPause job={job} onChanged={onChanged} />}

      {/* Asked of the job rather than of its sheet, because a job may carry
          its own parts list and then the sheet is not the answer. Shown on an
          installed job too: what it consumed is worth reading back. */}
      {!cancelled && (
        <JobParts job={job} committed={open} onChanged={onChanged} />
      )}

      {cancelled && (
        <p className="inv-state">
          This job is cancelled, so it holds no parts. Nothing is committed for it and
          nothing was deducted. Reopen it to claim its parts again.
        </p>
      )}

      <JobStatusActions
        job={job}
        install={install}
        onInstallChange={handleInstallChange}
        schedule={schedule}
        onScheduleChange={handleScheduleChange}
        busy={busy}
        crewDirty={open && crewDirty}
        revertTo={revertTo}
        onRevertTo={setRevertTo}
        confirmCancel={confirmCancel}
        onConfirmCancel={next => {
          if (next) { setNotice(''); setActionError('') }
          setConfirmCancel(next)
        }}
        actionError={actionError}
        notice={notice}
        onMarkInstalled={runMarkInstalled}
        onRevert={() => perform(() => revertInstall(job, revertTo))}
        onSchedule={date => perform(() => setScheduledDate(job, date))}
        onPlainStatus={next => perform(() => changeStatus(job, next))}
      />

      <JobPartsLedger jobId={job.id} refreshKey={ledgerKey} />

      {editing && (
        <JobEditModal
          job={job}
          focusField={editFocus}
          hasOwnParts={job.has_job_parts === true}
          onClose={() => setEditing(false)}
          onSaved={message => {
            setEditing(false)
            setActionError('')
            setNotice(message)
            setLedgerKey(k => k + 1)
            onChanged()
          }}
        />
      )}
    </Modal>
  )
}
