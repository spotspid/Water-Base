import { useState } from 'react'
import {
  agreementLabel, agreementStatusOf, agreementTone, canSendAgreement,
  isAwaitingSignature, sendAgreement,
} from '../lib/agreements'
import { formatDateTime } from '../lib/inventory'
import './Agreement.css'

// The agreement panel on the job detail modal.
//
// Sending emails a real customer, so the button never fires on one click. The
// confirm names who it is going to, because the most expensive mistake here is
// a signature request landing in a stranger's inbox.
export default function JobAgreement({ job, onChanged }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [details, setDetails] = useState(null)
  const [notice, setNotice] = useState('')

  const status = agreementStatusOf(job)
  const awaiting = isAwaitingSignature(job)
  const signed = status === 'completed'
  const email = job.customer_email || ''

  async function run() {
    setError('')
    setDetails(null)
    setNotice('')
    setBusy(true)

    const { data, error: err, details: extra } = await sendAgreement(job.id, 'customer_install')

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
      ? `Resent to ${data?.sent_to || email}. This is send ${count}.`
      : `Sent to ${data?.sent_to || email}. ${data?.fields_prefilled?.length || 0} fields were prefilled.`)
    onChanged()
  }

  return (
    <section className="agr-panel">
      <div className="agr-head">
        <div>
          <h3>Customer Agreement</h3>
          <p className="agr-sub">
            {email
              ? <>Goes to <strong>{email}</strong> through DocuSeal.</>
              : 'This job has no customer email, so nothing can be sent yet.'}
          </p>
        </div>
        <span className={`agr-badge agr-${agreementTone(job)}`}>{agreementLabel(job)}</span>
      </div>

      {(job.agreement_sent_at || job.agreement_completed_at) && (
        <p className="agr-timeline">
          {job.agreement_sent_at && <>Sent {formatDateTime(job.agreement_sent_at)}.</>}
          {job.agreement_completed_at && <> Signed {formatDateTime(job.agreement_completed_at)}.</>}
          {job.agreement_send_count > 1 && <> {job.agreement_send_count} sends.</>}
        </p>
      )}

      {signed && (
        <div className="agr-links">
          {job.agreement_signed_url && (
            <a className="tpl-link" href={job.agreement_signed_url}
              target="_blank" rel="noopener noreferrer">
              Signed document
            </a>
          )}
          {job.agreement_audit_log_url && (
            <a className="tpl-link" href={job.agreement_audit_log_url}
              target="_blank" rel="noopener noreferrer">
              Audit log
            </a>
          )}
        </div>
      )}

      {status === 'failed' && job.agreement_last_error && (
        <p className="form-error" role="alert">
          Last send failed. {job.agreement_last_error}
        </p>
      )}

      {error && (
        <div className="form-error" role="alert">
          <p>{error}</p>
          {details?.template_fields && (
            <p className="agr-detail">
              The template has these fields: {details.template_fields.join(', ')}.
            </p>
          )}
        </div>
      )}

      {notice && <p className="set-notice" role="status">{notice}</p>}

      {!signed && (
        <div className="agr-actions">
          {confirming ? (
            <>
              <span className="agr-confirm-text">
                This emails {email || 'the customer'} a signature request. Send it?
              </span>
              <button type="button" className="btn-primary" disabled={busy} onClick={run}>
                {busy ? 'Sending...' : awaiting ? 'Yes, resend' : 'Yes, send it'}
              </button>
              <button type="button" className="btn-cancel" disabled={busy}
                onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className={awaiting ? 'btn-cancel' : 'btn-primary'}
              disabled={busy || !email || !canSendAgreement(job)}
              onClick={() => { setConfirming(true); setError(''); setNotice('') }}
            >
              {awaiting ? 'Resend Agreement' : 'Send Agreement'}
            </button>
          )}
        </div>
      )}

      {signed && (
        <p className="agr-sub">
          Signed agreements are not resent from here. Start a new one in DocuSeal if the
          contract genuinely changed.
        </p>
      )}
    </section>
  )
}
