import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { listSubmissions } from '../lib/agreements'
import { scanGaps } from '../lib/docusealScan'
import { formatDay } from '../lib/inventory'

// What DocuSeal has signed that Water Base does not know about.
//
// The paperwork is signed in DocuSeal, and for a long time that was the only
// place it existed: eight signed agreements sat there for a month with no job
// here, so nothing was scheduled, reserved or forecast against them. This
// panel is the check nobody was doing.
//
// Read only, deliberately and completely. It lists DocuSeal through the send
// function's list mode, which performs a GET and nothing else, reads jobs and
// the two agreement tables here, and compares them. It links nothing and
// creates nothing: what to do about a gap is a decision, and a page that made
// it silently would be worse than the gap.
//
// It runs when asked rather than on page load. Every scan is a round trip to
// DocuSeal for the whole account, which is not something to do each time
// somebody opens the Documents page.

// A page cap, so a bad cursor cannot spin this in a browser tab. Ten pages of
// a hundred is far more paperwork than this business has.
const MAX_PAGES = 10

async function loadListing() {
  const rows = []

  for (const archived of [false, true]) {
    let after = ''

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await listSubmissions({ archived, after })
      if (result.error) return { rows, error: result.error }

      rows.push(...result.rows)

      const next = result.next ? String(result.next) : ''
      if (result.rows.length === 0 || !next || next === after) break
      after = next
    }
  }

  return { rows, error: null }
}

function GapTable({ rows, showJob }) {
  return (
    <div className="table-wrap">
      <table className="jobs-table">
        <thead>
          <tr>
            <th>Signer</th>
            <th>Document</th>
            <th>Signed</th>
            <th>Scheduled</th>
            {showJob && <th>Job here</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.id}>
              <td className="td-customer">
                {row.signer}
                <span className="cell-sub">DocuSeal {row.id}{row.archived ? ', archived' : ''}</span>
              </td>
              <td>{row.title}</td>
              <td>{row.signedAt ? formatDay(row.signedAt) : <span className="cell-unset">not recorded</span>}</td>
              <td>
                {row.scheduledDate
                  ? formatDay(row.scheduledDate)
                  : <span className="cell-unset">not in the title</span>}
              </td>
              {showJob && (
                <td>
                  {row.jobName}
                  <span className="cell-sub">{row.jobStatus}</span>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function DocumentsGaps() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const scan = useCallback(async () => {
    setBusy(true)
    setError('')

    const listing = await loadListing()

    if (listing.error) {
      setBusy(false)
      setError(listing.error)
      setResult(null)
      return
    }

    const [jobs, agreements, history] = await Promise.all([
      attempt(() => supabase.from('jobs').select('id, customer_name, customer_email, status'),
        'The jobs could not be read.'),
      attempt(() => supabase.from('agreements').select('docuseal_submission_id'),
        'The linked documents could not be read.'),
      attempt(() => supabase.from('agreement_history').select('docuseal_submission_id'),
        'The earlier documents could not be read.'),
    ])

    const failure = jobs.error || agreements.error || history.error

    if (failure) {
      setBusy(false)
      setError(failure)
      setResult(null)
      return
    }

    const linkedIds = [...(agreements.data || []), ...(history.data || [])]
      .map(row => row.docuseal_submission_id)
      .filter(Boolean)

    setResult({
      ...scanGaps({ submissions: listing.rows, jobs: jobs.data || [], linkedIds }),
      scanned: listing.rows.length,
      linked: new Set(linkedIds.map(String)).size,
      at: new Date(),
    })
    setBusy(false)
  }, [])

  const nothing = result && result.missingJobs.length === 0 && result.unlinked.length === 0

  return (
    <section className="dash-panel doc-gaps">
      <header className="dash-panel-head">
        <h2>Signed in DocuSeal, missing here</h2>
        <span className="dash-panel-note">
          Reads the whole DocuSeal account and compares it with this app. Nothing is linked or
          created: it only reports.
        </span>
        <button type="button" className="btn-cancel" onClick={scan} disabled={busy}>
          {busy ? 'Scanning...' : result ? 'Scan again' : 'Scan DocuSeal'}
        </button>
      </header>

      {error && (
        <div className="inv-error-box" role="alert">
          <p className="inv-error-title">DocuSeal could not be scanned.</p>
          <p className="inv-error-detail">{error}</p>
          <button type="button" className="btn-cancel" onClick={scan} disabled={busy}>Try again</button>
        </div>
      )}

      {!result && !error && !busy && (
        <p className="inv-state">
          Not scanned yet. A scan reads every submission in the account, signed and archived
          included, and reports the ones this app has never heard of.
        </p>
      )}

      {result && (
        <p className="inv-ledger-note">
          {result.scanned} documents in DocuSeal, {result.linked} already on a job here.
          Scanned {result.at.toLocaleTimeString()}. Only signed documents are listed: one still
          waiting on a signature is a quote, not a gap.
        </p>
      )}

      {nothing && (
        <p className="inv-state">Every signed document in DocuSeal is on a job here.</p>
      )}

      {result && result.missingJobs.length > 0 && (
        <>
          <p className="doc-group-head">
            Signed, with no job here ({result.missingJobs.length})
          </p>
          <p className="inv-ledger-note">
            Nobody wrote these up, so they hold no parts, appear on no schedule and count in no
            forecast. Contractor paperwork, such as a W9, shows here too and belongs to nobody.
          </p>
          <GapTable rows={result.missingJobs} showJob={false} />
        </>
      )}

      {result && result.unlinked.length > 0 && (
        <>
          <p className="doc-group-head">
            Signed, job here, document not linked ({result.unlinked.length})
          </p>
          <p className="inv-ledger-note">
            The job exists and its signed document is not attached, so the job reads as unsigned
            and keeps being chased.
          </p>
          <GapTable rows={result.unlinked} showJob />
        </>
      )}
    </section>
  )
}
