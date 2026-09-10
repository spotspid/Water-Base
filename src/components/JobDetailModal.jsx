import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { CANCELLED_STATUS, STATUS_LABELS } from '../lib/constants'
import { attempt } from '../lib/errors'
import { formatCurrency } from '../lib/inventory'
import { useInstallers } from '../lib/useInstallers'
import { crewLabel, formatLongDate } from '../lib/schedule'
import { metaLine } from '../lib/text'
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

  const installed = job.status === 'installed'
  const cancelled = job.status === CANCELLED_STATUS
  const open = !installed && !cancelled

  function handleInstallChange(e) {
    const { name, value } = e.target
    setInstall(f => ({ ...f, [name]: value }))
  }

  function finish(message) {
    setNotice(message)
    setLedgerKey(k => k + 1)
    setConfirmCancel(false)
    onChanged()
  }

  async function runMarkInstalled() {
    // The button is disabled while this is true, so reaching here means
    // something raced it. Refusing is cheaper than recording stale values.
    if (crewDirty) {
      setActionError('Save or undo the crew and pay changes above before marking this installed.')
      return
    }

    setActionError('')
    setNotice('')
    setBusy(true)

    // Crew and pay are already on the row, saved by the section above through
    // schedule_job and its roster rules. This used to write installer_id with
    // a plain update first, which skipped those rules and could hand an
    // installer switched off in Settings a finished job. A null payout tells
    // the function to keep the saved one.
    const { data, error } = await attempt(
      () => supabase.rpc('mark_job_installed', {
        p_job_id: job.id,
        p_install_date: install.install_date || null,
        p_installer: null,
        p_payout: null,
      }),
      'The job could not be marked installed.',
    )

    setBusy(false)

    if (error) {
      setActionError(error)
      // the job may have moved under us, so pull fresh numbers either way
      onChanged()
      return
    }

    const lines = data?.lines_deducted ?? 0
    finish(lines === 0
      ? 'Marked installed. This template has no parts, so nothing was deducted from inventory.'
      : `Marked installed. ${lines} ${lines === 1 ? 'item' : 'items'} deducted, ${formatCurrency(data?.parts_cost || 0)} of parts.`)
  }

  async function runRevert() {
    setActionError('')
    setNotice('')
    setBusy(true)

    const { data, error } = await attempt(
      () => supabase.rpc('revert_job_install', { p_job_id: job.id, p_new_status: revertTo }),
      'The install could not be reversed.',
    )

    setBusy(false)

    if (error) {
      setActionError(error)
      onChanged()
      return
    }

    const lines = data?.lines_reversed ?? 0
    finish(`Install reversed. ${lines} ${lines === 1 ? 'item was' : 'items were'} returned to inventory, and the job is now ${STATUS_LABELS[revertTo] || revertTo} with its parts committed again.`)
  }

  // What a plain status change means for the reservation layer. The database
  // trigger does the work, so this only has to say what happened.
  function statusNotice(next) {
    if (next === CANCELLED_STATUS) {
      return 'Job cancelled. Every part it had committed is released and back in available. '
        + 'Nothing moved in the ledger, because a cancelled job never consumed anything.'
    }
    if (cancelled) {
      return `Job reopened as ${STATUS_LABELS[next] || next}. Its parts are committed again.`
    }
    return `Job moved to ${STATUS_LABELS[next] || next}.`
  }

  async function runPlainStatus(next) {
    setActionError('')
    setNotice('')
    setBusy(true)

    const { error } = await attempt(
      () => supabase.from('jobs').update({ status: next }).eq('id', job.id),
      'The status could not be changed.',
    )

    setBusy(false)

    if (error) {
      setActionError(error)
      onChanged()
      return
    }

    finish(statusNotice(next))
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
        onRevert={runRevert}
        onPlainStatus={runPlainStatus}
      />

      <JobPartsLedger jobId={job.id} refreshKey={ledgerKey} />
    </Modal>
  )
}
