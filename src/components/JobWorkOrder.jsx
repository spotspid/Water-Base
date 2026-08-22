import { useState } from 'react'
import {
  WORK_ORDER_TYPE, isWorkOrderOut, sendAgreement, workOrderBlocker,
  workOrderLabel, workOrderReady, workOrderTone,
} from '../lib/agreements'
import { formatDateTime } from '../lib/inventory'

// The work order panel, beside the customer agreement on the job record.
//
// Nothing here sends on its own. Assigning a crew makes the offer appear, but
// the send is always a deliberate second act behind a confirm, because it puts
// a document in a subcontractor's inbox. That also settles the reassignment
// case: there is no path that sends twice, because there is no path that sends
// once without being asked.
export default function JobWorkOrder({ job, onChanged }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [details, setDetails] = useState(null)
  const [notice, setNotice] = useState('')

  const blocker = workOrderBlocker(job)
  const ready = workOrderReady(job)
  const out = isWorkOrderOut(job)
  const signed = job.work_order_status === 'completed'
  const crew = job.installer_name || 'the installer'
  const sends = Number(job.work_order_send_count) || 0

  async function run() {
    setError('')
    setDetails(null)
    setNotice('')
    setBusy(true)

    const { data, error: err, details: extra } = await sendAgreement(job.id, WORK_ORDER_TYPE)

    setBusy(false)
    setConfirming(false)

    if (err) {
      setError(err)
      setDetails(extra)
      onChanged()
      return
    }

    const count = data?.send_count || 1
    setNotice(count > 1
      ? `Resent to ${data?.sent_to}. This is send ${count}.`
      : `Sent to ${data?.sent_to} with ${data?.parts_listed ?? 0} parts listed.`)
    onChanged()
  }

  return (
    <section className="agr-panel">
      <div className="agr-head">
        <div>
          <h3>Work Order</h3>
          <p className="agr-sub">
            {job.installer_email
              ? <>Goes to <strong>{crew}</strong> at {job.installer_email}, with this job's parts list.</>
              : 'Assign a crew with an email address and this can be sent.'}
          </p>
        </div>
        <span className={`agr-badge agr-${workOrderTone(job)}`}>{workOrderLabel(job)}</span>
      </div>

      {(job.work_order_sent_at || job.work_order_completed_at) && (
        <p className="agr-timeline">
          {job.work_order_sent_at && <>Sent {formatDateTime(job.work_order_sent_at)}.</>}
          {job.work_order_completed_at && <> Signed {formatDateTime(job.work_order_completed_at)}.</>}
          {sends > 1 && <> {sends} sends.</>}
        </p>
      )}

      {signed && (
        <div className="agr-links">
          {job.work_order_signed_url && (
            <a className="tpl-link" href={job.work_order_signed_url}
              target="_blank" rel="noopener noreferrer">
              Signed work order
            </a>
          )}
          {job.work_order_audit_log_url && (
            <a className="tpl-link" href={job.work_order_audit_log_url}
              target="_blank" rel="noopener noreferrer">
              Audit log
            </a>
          )}
        </div>
      )}

      {job.work_order_status === 'failed' && job.work_order_last_error && (
        <p className="form-error" role="alert">Last send failed. {job.work_order_last_error}</p>
      )}

      {/* the offer. Appears the moment a scheduled job has a crew. */}
      {ready && !confirming && (
        <p className="agr-offer">
          {crew} is assigned and this job has a date. Send the work order?
        </p>
      )}

      {/* sent, but the crew has changed since. Worth saying out loud. */}
      {out && (
        <p className="agr-sub">
          Already with {crew}. Resending replaces nothing, it sends a second document,
          so only do it if the job or the crew actually changed.
        </p>
      )}

      {blocker && !signed && <p className="agr-sub">{blocker}</p>}

      {error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
          {details?.template_fields && (
            <p className="agr-detail">The template has these fields: {details.template_fields.join(', ')}.</p>
          )}
        </div>
      )}

      {notice && <p className="set-notice" role="status">{notice}</p>}

      {!signed && (
        <div className="agr-actions">
          {confirming ? (
            <>
              <span className="agr-confirm-text">
                This emails {crew} at {job.installer_email} a work order to sign. Send it?
              </span>
              <button type="button" className="btn-primary" disabled={busy} onClick={run}>
                {busy ? 'Sending...' : out ? 'Yes, send again' : 'Yes, send it'}
              </button>
              <button type="button" className="btn-cancel" disabled={busy}
                onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className={ready ? 'btn-primary' : 'btn-cancel'}
              disabled={busy || Boolean(blocker)}
              onClick={() => { setConfirming(true); setError(''); setNotice('') }}
            >
              {out ? 'Resend Work Order' : 'Send Work Order'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
