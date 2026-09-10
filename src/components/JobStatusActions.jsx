import { CANCELLED_STATUS, STATUS_LABELS } from '../lib/constants'
import { formatDateTime } from '../lib/inventory'

// The status half of the job detail modal: where it is now, and the buttons
// that move it. Split out of JobDetailModal so that file stays about loading
// and saving rather than about layout.
//
// Installer and pay used to live here, feeding only "Mark installed", which
// meant a payout could be typed and never saved. They moved to the crew and
// pay section, which has its own save. What stays is the install date, and it
// stays on purpose: it is the day the work actually happened, so it belongs to
// the act of marking the job installed and has no meaning before that.
//
// Every action here is presentational. The work itself lives in the parent,
// which owns the one busy flag so two buttons cannot fire at once.
export default function JobStatusActions({
  job, install, onInstallChange, busy, crewDirty,
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
            <label htmlFor="install_date">Installed on</label>
            <input id="install_date" name="install_date" type="date"
              value={install.install_date} onChange={onInstallChange} disabled={busy} />
            <span className="field-hint">
              Recorded when you mark it installed. Crew and pay come from the section above.
            </span>
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

      {/* Marking installed records the crew and pay on the job. Doing it over
          unsaved changes would record the old values while the screen showed
          new ones, so it waits until they are saved or undone. */}
      {open && crewDirty && (
        <p className="form-warning" role="status">
          Save or undo the crew and pay changes above before marking this installed.
        </p>
      )}

      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {notice && <p className="job-notice" role="status">{notice}</p>}

      <div className="modal-actions job-action-buttons">
        {job.status === 'sold' && (
          <button type="button" className="btn-cancel"
            onClick={() => onPlainStatus('scheduled')} disabled={busy}>
            Mark scheduled
          </button>
        )}
        {job.status === 'scheduled' && (
          <button type="button" className="btn-cancel"
            onClick={() => onPlainStatus('sold')} disabled={busy}>
            Back to sold
          </button>
        )}
        {open && (confirmCancel ? (
          <>
            <button type="button" className="btn-cancel"
              onClick={() => onConfirmCancel(false)} disabled={busy}>
              Keep job
            </button>
            <button type="button" className="btn-danger"
              onClick={() => onPlainStatus(CANCELLED_STATUS)} disabled={busy}>
              {busy ? 'Working...' : 'Cancel job and release parts'}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-cancel" disabled={busy}
              onClick={() => onConfirmCancel(true)}>
              Cancel job
            </button>
            <button type="button" className="btn-primary" onClick={onMarkInstalled}
              disabled={busy || crewDirty}>
              {busy ? 'Working...' : 'Mark installed and deduct parts'}
            </button>
          </>
        ))}
        {cancelled && (
          <button type="button" className="btn-primary"
            onClick={() => onPlainStatus('sold')} disabled={busy}>
            {busy ? 'Working...' : 'Reopen as sold'}
          </button>
        )}
        {installed && (
          <button type="button" className="btn-primary" onClick={onRevert} disabled={busy}>
            {busy ? 'Working...' : 'Reverse install and return parts'}
          </button>
        )}
      </div>
    </section>
  )
}
