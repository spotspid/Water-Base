import { useState } from 'react'
import { CANCELLED_STATUS } from '../lib/constants'
import { formatCurrency } from '../lib/inventory'
import { useInstallers } from '../lib/useInstallers'
import { crewLabel, formatLongDate } from '../lib/schedule'
import { metaLine } from '../lib/text'
import {
  changeStatus, markInstalled, revertInstall, setScheduledDate,
} from '../lib/jobActions'
import JobAgreement from './JobAgreement'
import JobWorkOrder from './JobWorkOrder'
import JobPartsLedger from './JobPartsLedger'
import JobDeposits from './JobDeposits'
import JobNagPause from './JobNagPause'
import JobSiteConditions from './JobSiteConditions'
import JobCrewPay from './JobCrewPay'
import JobStatusActions from './JobStatusActions'
import JobPartsPreview from './JobPartsPreview'
import Modal from './Modal'

export default function JobDetailModal({ job, onClose, onChanged }) {
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
          <span className="inv-stat-value">{formatCurrency(job.parts_cost)}</span>
        </div>
        <div className="job-margin-cell job-margin-minus">
          <span className="inv-stat-label">Installer Pay</span>
          <span className="inv-stat-value">{formatCurrency(job.installer_pay)}</span>
        </div>
        <div className={Number(job.margin) < 0 ? 'job-margin-cell job-margin-total job-margin-bad' : 'job-margin-cell job-margin-total'}>
          <span className="inv-stat-label">Margin</span>
          <span className="inv-stat-value">
            {formatCurrency(job.margin)}
            {job.margin_pct != null && (
              <span className="job-margin-pct">{Number(job.margin_pct).toFixed(1)}%</span>
            )}
          </span>
        </div>
      </div>

      <p className="inv-ledger-note">
        Parts cost is summed from the ledger at the cost stamped on each row, so changing an
        item cost later does not rewrite the margin on a job that already installed.
      </p>

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

      {!cancelled && <JobNagPause job={job} onChanged={onChanged} />}

      {open && (
        <JobPartsPreview
          templateId={job.template_id}
          templateLabel={job.system_template}
          faucetFinish={job.faucet_finish}
          roType={job.ro_type}
          valveType={job.valve_type}
          committed
        />
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
    </Modal>
  )
}
