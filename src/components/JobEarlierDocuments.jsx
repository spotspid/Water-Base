import { useEffect, useState } from 'react'
import { WORK_ORDER_TYPE, fetchAgreementHistory } from '../lib/agreements'
import { formatDateTime } from '../lib/inventory'

// Signed documents this job keeps but does not point at.
//
// The agreement and work order panels above show the one current document of
// each kind. A job can have signed more than one: a work order redone when the
// date moved, or one signed by an installer who did not finish the job. Those
// are part of the record, so they are listed here with the reason they are not
// the current one. Read only: rows are written when the history is corrected,
// never from this screen.
//
// Shows nothing at all for a job with no history, which is almost every job.
export default function JobEarlierDocuments({ job }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true

    fetchAgreementHistory(job.id).then(({ data, error: err }) => {
      if (!live) return
      setError(err || '')
      setRows(err ? [] : (data || []))
    })

    return () => { live = false }
  }, [job.id])

  if (!error && rows.length === 0) return null

  return (
    <section className="agr-panel">
      <div className="agr-head">
        <div>
          <h3>Earlier signed documents</h3>
          <p className="agr-sub">Kept on the record. Not the current document for this job.</p>
        </div>
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {rows.map(row => (
        <div key={row.id} className="agr-history-row">
          <p className="agr-timeline">
            <strong>{row.type === WORK_ORDER_TYPE ? 'Work order' : 'Customer agreement'}</strong>
            {' '}DocuSeal {row.docuseal_submission_id}.
            {row.completed_at && <> Signed {formatDateTime(row.completed_at)}</>}
            {row.signed_by && <> by {row.signed_by}</>}.
          </p>
          <p className="agr-sub">{row.note}</p>
        </div>
      ))}
    </section>
  )
}
