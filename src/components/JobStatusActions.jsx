import { CANCELLED_STATUS, STATUS_LABELS } from '../lib/constants'
import { formatDateTime } from '../lib/inventory'
import { installerLabel } from '../lib/useInstallers'

// The status half of the job detail modal: where it is now, the fields an
// install needs, and the buttons that move it. Split out of JobDetailModal so
// that file stays about loading and saving rather than about layout.
//
// Every action here is presentational. The work itself lives in the parent,
// which owns the one busy flag so two buttons cannot fire at once.
export default function JobStatusActions({
  job, install, onInstallChange, installers, loadingCrew, busy,
  revertTo, onRevertTo, confirmCancel, onConfirmCancel,
  actionError, notice, onMarkInstalled, onRevert, onPlainStatus,
}) {
  const installed = job.status === 'installed'
  const cancelled = job.status === CANCELLED_STATUS
  const open = !installed && !cancelled

  return (
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

      {open && (
        <div className="form-grid job-install-grid">
          <div className="field">
            <label htmlFor="install_date">Install Date</label>
            <input id="install_date" name="install_date" type="date"
              value={install.install_date} onChange={onInstallChange} disabled={busy} />
          </div>
          <div className="field">
            <label htmlFor="installer_id">Installer</label>
            <select id="installer_id" name="installer_id" value={install.installer_id}
              onChange={onInstallChange} disabled={busy || loadingCrew}>
              <option value="">{loadingCrew ? 'Loading crew...' : 'Unassigned'}</option>
              {installers.map(i => (
                <option key={i.id} value={i.id} disabled={!i.active}>{installerLabel(i)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="payout_amount">Installer Pay ($)</label>
            <input id="payout_amount" name="payout_amount" type="number" min="0" step="0.01"
              value={install.payout_amount} onChange={onInstallChange} disabled={busy} />
          </div>
        </div>
      )}

      {installed && (
        <div className="field job-revert-field">
          <label htmlFor="revert_to">Move back to</label>
          <select id="revert_to" value={revertTo}
            onChange={e => onRevertTo(e.target.value)} disabled={busy}>
            <option value="scheduled">Scheduled</option>
            <option value="sold">Sold</option>
          </select>
          <span className="field-hint">Every part deducted for this install is returned to inventory.</span>
        </div>
      )}

      {confirmCancel && (
        <p className="form-warning" role="status">
          Cancelling releases every part this job has committed and returns it to
          available. The job stays in the list as cancelled and stops counting toward
          revenue and margin. Nothing is deducted or returned in the ledger.
        </p>
      )}

      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {notice && <p className="job-notice" role="status">{notice}</p>}

      <div className="modal-actions job-action-buttons">
        {job.status === 'sold' && (
          <button type="button" className="btn-cancel"
            onClick={() => onPlainStatus('scheduled')} disabled={busy}>
            Mark Scheduled
          </button>
        )}
        {job.status === 'scheduled' && (
          <button type="button" className="btn-cancel"
            onClick={() => onPlainStatus('sold')} disabled={busy}>
            Back to Sold
          </button>
        )}
        {open && (confirmCancel ? (
          <>
            <button type="button" className="btn-cancel"
              onClick={() => onConfirmCancel(false)} disabled={busy}>
              Keep Job
            </button>
            <button type="button" className="btn-danger"
              onClick={() => onPlainStatus(CANCELLED_STATUS)} disabled={busy}>
              {busy ? 'Working...' : 'Cancel Job and Release Parts'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-cancel" disabled={busy}
              onClick={() => onConfirmCancel(true)}>
              Cancel Job
            </button>
            <button type="button" className="btn-primary" onClick={onMarkInstalled} disabled={busy}>
              {busy ? 'Working...' : 'Mark Installed and Deduct Parts'}
            </button>
          </>
        ))}
        {cancelled && (
          <button type="button" className="btn-primary"
            onClick={() => onPlainStatus('sold')} disabled={busy}>
            {busy ? 'Working...' : 'Reopen as Sold'}
          </button>
        )}
        {installed && (
          <button type="button" className="btn-primary" onClick={onRevert} disabled={busy}>
            {busy ? 'Working...' : 'Reverse Install and Return Parts'}
          </button>
        )}
      </div>
    </section>
  )
}
