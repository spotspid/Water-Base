import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { STATUS_LABELS } from '../lib/constants'
import { attempt } from '../lib/errors'
import { formatCurrency, formatDateTime } from '../lib/inventory'
import JobPartsLedger from './JobPartsLedger'
import JobPartsPreview from './JobPartsPreview'
import Modal from './Modal'

export default function JobDetailModal({ job, onClose, onChanged }) {
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [ledgerKey, setLedgerKey] = useState(0)
  const [revertTo, setRevertTo] = useState('scheduled')
  const [install, setInstall] = useState({
    install_date: job.install_date || '',
    installer: job.installer || '',
    payout_amount: job.installer_pay == null ? '' : String(job.installer_pay),
  })

  const installed = job.status === 'installed'

  function handleInstallChange(e) {
    const { name, value } = e.target
    setInstall(f => ({ ...f, [name]: value }))
  }

  function finish(message) {
    setNotice(message)
    setLedgerKey(k => k + 1)
    onChanged()
  }

  async function runMarkInstalled() {
    if (install.payout_amount !== '') {
      const payout = Number(install.payout_amount)
      if (!Number.isFinite(payout) || payout < 0) {
        setActionError('Installer pay must be zero or greater, or left blank.')
        return
      }
    }

    setActionError('')
    setNotice('')
    setBusy(true)

    const { data, error } = await attempt(
      () => supabase.rpc('mark_job_installed', {
        p_job_id: job.id,
        p_install_date: install.install_date || null,
        p_installer: install.installer.trim() || null,
        p_payout: install.payout_amount === '' ? null : Number(install.payout_amount),
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
    finish(`Install reversed. ${lines} ${lines === 1 ? 'item was' : 'items were'} returned to inventory and the job is now ${STATUS_LABELS[revertTo] || revertTo}.`)
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
      return
    }

    finish(`Job moved to ${STATUS_LABELS[next] || next}.`)
  }

  const subtitle = `${job.system_template} · ${job.city} · Invoice ${job.invoice_number}`

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

      {!installed && (
        <JobPartsPreview
          templateId={job.template_id}
          templateLabel={job.system_template}
          faucetFinish={job.faucet_finish}
        />
      )}

      <section className="job-action">
        <h3>Status</h3>
        <p className="job-action-current">
          Currently
          {' '}
          <span className={`status-badge status-${job.status}`}>
            {STATUS_LABELS[job.status] || job.status}
          </span>
          {job.parts_deducted_at && (
            <span className="job-action-stamp">
              Parts deducted {formatDateTime(job.parts_deducted_at)}
            </span>
          )}
        </p>

        {!installed && (
          <div className="form-grid job-install-grid">
            <div className="field">
              <label htmlFor="install_date">Install Date</label>
              <input id="install_date" name="install_date" type="date"
                value={install.install_date} onChange={handleInstallChange} disabled={busy} />
            </div>
            <div className="field">
              <label htmlFor="installer">Installer</label>
              <input id="installer" name="installer" type="text"
                value={install.installer} onChange={handleInstallChange} disabled={busy} />
            </div>
            <div className="field">
              <label htmlFor="payout_amount">Installer Pay ($)</label>
              <input id="payout_amount" name="payout_amount" type="number" min="0" step="0.01"
                value={install.payout_amount} onChange={handleInstallChange} disabled={busy} />
            </div>
          </div>
        )}

        {installed && (
          <div className="field job-revert-field">
            <label htmlFor="revert_to">Move back to</label>
            <select id="revert_to" value={revertTo}
              onChange={e => setRevertTo(e.target.value)} disabled={busy}>
              <option value="scheduled">Scheduled</option>
              <option value="sold">Sold</option>
            </select>
            <span className="field-hint">Every part deducted for this install is returned to inventory.</span>
          </div>
        )}

        {actionError && <p className="form-error" role="alert">{actionError}</p>}
        {notice && <p className="job-notice" role="status">{notice}</p>}

        <div className="modal-actions job-action-buttons">
          {job.status === 'sold' && (
            <button type="button" className="btn-cancel"
              onClick={() => runPlainStatus('scheduled')} disabled={busy}>
              Mark Scheduled
            </button>
          )}
          {job.status === 'scheduled' && (
            <button type="button" className="btn-cancel"
              onClick={() => runPlainStatus('sold')} disabled={busy}>
              Back to Sold
            </button>
          )}
          {!installed && (
            <button type="button" className="btn-primary" onClick={runMarkInstalled} disabled={busy}>
              {busy ? 'Working...' : 'Mark Installed and Deduct Parts'}
            </button>
          )}
          {installed && (
            <button type="button" className="btn-primary" onClick={runRevert} disabled={busy}>
              {busy ? 'Working...' : 'Reverse Install and Return Parts'}
            </button>
          )}
        </div>
      </section>

      <JobPartsLedger jobId={job.id} refreshKey={ledgerKey} />
    </Modal>
  )
}
