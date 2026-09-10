import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { sendAgreement } from '../lib/agreements'
import {
  BLOCKED, OUT, SECTIONS, SIGNED,
  documentCounts, documentRows, groupByReason, inSection,
} from '../lib/documents'
import AppShell from '../components/AppShell'
import EmptyState from '../components/EmptyState'
import DocumentRow from '../components/DocumentRow'
import './Documents.css'

// Every customer agreement and work order in the business, in one place.
//
// The dashboard shows only what somebody is sitting on. This is the whole
// book, so the backlog that is nobody's fault yet has somewhere to live rather
// than being invisible until an install date arrives.
//
// Everything workOrderBlocker needs is selected, because the blocked section
// is grouped by exactly what it reports and a missing column would silently
// turn a blocked row into a sendable one.
const JOB_COLUMNS =
  'id, created_at, customer_name, customer_email, status, scheduled_date, invoice_number, '
  + 'installer_id, installer_name, installer_email, installer_pay, '
  + 'template_id, template_line_count, system_template, '
  + 'agreement_status, agreement_sent_at, work_order_status, work_order_sent_at'

const TABS = [
  { key: 'all', label: 'All' },
  { key: BLOCKED, label: 'Cannot send' },
  { key: OUT, label: 'Out for signature' },
  { key: SIGNED, label: 'Signed' },
]

export default function Documents() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('all')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [sendError, setSendError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const { data, error: err } = await attempt(
      () => supabase.from('job_margin').select(JOB_COLUMNS).order('created_at', { ascending: false }),
      'The documents could not be loaded.',
    )

    if (err) {
      setError(err)
      setJobs([])
    } else {
      setJobs(data || [])
    }

    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const rows = useMemo(() => documentRows(jobs), [jobs])
  const counts = useMemo(() => documentCounts(rows), [rows])
  const groups = useMemo(() => groupByReason(rows), [rows])

  const handleSend = useCallback(async row => {
    setBusy(row.key)
    setNotice('')
    setSendError('')

    const { error: err } = await attempt(
      () => sendAgreement(row.job_id, row.type),
      `The ${row.document.toLowerCase()} could not be sent.`,
    )

    setBusy('')

    // Reload either way. A failure still writes a failed row on the agreement,
    // and leaving the old state on screen would hide that.
    if (err) setSendError(err)
    else setNotice(`${row.document} sent to ${row.customer_name}.`)

    await load()
  }, [load])

  const hasData = !loading && !error
  const showing = tab === 'all' ? null : tab

  return (
    <AppShell
      subtitle={hasData ? `${counts.total} documents across ${jobs.length} jobs` : undefined}
      actions={(
        <button type="button" className="btn-cancel" onClick={load} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      )}
    >
      <div className="doc-page">
        {loading && <p className="inv-state">Loading documents...</p>}

        {!loading && error && (
          <div className="inv-error-box" role="alert">
            <p className="inv-error-title">The documents could not be loaded.</p>
            <p className="inv-error-detail">{error}</p>
            <p className="inv-error-hint">
              This page reads the <code>job_margin</code> view. If it is missing, apply the
              migrations in <code>supabase/migrations</code> and reload.
            </p>
            <button type="button" className="btn-cancel" onClick={load}>Try again</button>
          </div>
        )}

        {hasData && jobs.length === 0 && (
          <EmptyState title="No jobs yet">
            <p>
              Documents belong to jobs, so this page fills in as soon as the first job is
              written up.
            </p>
          </EmptyState>
        )}

        {hasData && jobs.length > 0 && (
          <>
            <div className="doc-cards">
              <Card
                label="Cannot send yet"
                value={counts.blocked}
                note="Waiting on the job"
                tone={counts.blocked > 0 ? 'bad' : 'quiet'}
              />
              <Card
                label="Out for signature"
                value={counts.out}
                note="Sent, not signed back"
                tone={counts.out > 0 ? 'warn' : 'quiet'}
              />
              <Card
                label="Signed"
                value={counts.signed}
                note="Done and on file"
                tone="good"
              />
              <Card
                label="Documents"
                value={counts.total}
                note={`Across ${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`}
                tone="quiet"
              />
            </div>

            <div className="doc-tabs" role="tablist" aria-label="Filter documents">
              {TABS.map(t => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={tab === t.key ? 'doc-tab doc-tab-on' : 'doc-tab'}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  <span className="doc-tab-n">
                    {t.key === 'all' ? counts.total : counts[t.key]}
                  </span>
                </button>
              ))}
            </div>

            {notice && <p className="job-notice" role="status">{notice}</p>}
            {sendError && <p className="form-error" role="alert">{sendError}</p>}

            {SECTIONS.map(section => {
              if (showing && showing !== section.key) return null

              const sectionRows = inSection(rows, section.key)
              if (sectionRows.length === 0) return null

              return (
                <section className="dash-panel" key={section.key}>
                  <header className="dash-panel-head">
                    <h2>{section.title}</h2>
                    <span className="dash-panel-note">{section.note}</span>
                    <span className="doc-count">{sectionRows.length}</span>
                  </header>

                  {section.key === BLOCKED ? (
                    groups.map(group => (
                      <div className="doc-group" key={group.key}>
                        <p className="doc-group-head">
                          Needs {group.short}
                          <span className="doc-group-n">{group.rows.length}</span>
                        </p>
                        <ul className="doc-list">
                          {group.rows.map(row => (
                            <DocumentRow key={row.key} row={row} busy={busy}
                              onSend={handleSend} showReason={false} />
                          ))}
                        </ul>
                      </div>
                    ))
                  ) : (
                    <ul className="doc-list">
                      {sectionRows.map(row => (
                        <DocumentRow key={row.key} row={row} busy={busy}
                          onSend={handleSend} showReason={false} />
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}

            {showing && inSection(rows, showing).length === 0 && (
              <p className="inv-state">Nothing in this group.</p>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}

function Card({ label, value, note, tone }) {
  return (
    <article className={`doc-card doc-card-${tone}`}>
      <span className="doc-card-k">{label}</span>
      <span className="doc-card-v">{value}</span>
      <span className="doc-card-n">{note}</span>
    </article>
  )
}
