import { installLabel, sentLabel } from '../lib/documents'

// One document, as a row.
//
// The send button is disabled rather than hidden on a blocked row, and that is
// deliberate. Hiding it would leave the row looking like a record with nothing
// to do about it; a dead button with the reason beside it says "this is the
// thing you would press, and here is why you cannot yet".
export default function DocumentRow({ row, busy, onSend, showReason }) {
  const blocked = row.gaps.length > 0 || row.job_status === 'cancelled'
  const sending = busy === row.key

  return (
    <li className="doc-row">
      <span className="doc-main">
        <span className="doc-who">{row.customer_name}</span>
        <span className="doc-meta">
          {row.document}
          {row.installer_name && <> &middot; {row.installer_name}</>}
        </span>
        {showReason && row.reason && (
          <span className="doc-reason">{row.reason}</span>
        )}
      </span>

      <span className={`pill pill-${row.tone}`}>
        <span className="pill-dot" />
        {row.label}
      </span>

      <span className="doc-when">
        {row.state === 'unsigned' || row.state === 'declined' || row.state === 'failed'
          ? sentLabel(row)
          : ''}
      </span>

      <span className={installClass(row)}>
        {installLabel(row)}
      </span>

      <span className="doc-act">
        {row.state === 'signed' ? (
          <span className="doc-done">On file</span>
        ) : (
          <button
            type="button"
            className="btn-cancel btn-small"
            disabled={blocked || sending}
            title={blocked ? row.reason : `Send the ${row.document.toLowerCase()}`}
            onClick={() => onSend(row)}
          >
            {sending ? 'Sending...' : row.state === 'unsent' ? 'Send' : 'Resend'}
          </button>
        )}
      </span>
    </li>
  )
}

// Overdue is maroon and soon is amber. Both used to be maroon, which put
// "in 2 days" and "1 day overdue" in the same alarm and flattened the urgency.
function installClass(row) {
  const n = row?.untilInstall
  if (n === null || n === undefined) return 'doc-install'
  if (n < 0) return 'doc-install doc-install-late'
  if (n <= 2) return 'doc-install doc-install-soon'
  return 'doc-install'
}
