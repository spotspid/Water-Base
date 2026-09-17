import { QUOTED_STATUS, STATUS_LABELS } from '../lib/constants'

// The filter bar over the jobs table: status, search, and the test rows.
//
// Quoted is left out of the status list because quotes are not on this page
// at all; they have their own.
export default function JobsToolbar({
  status, onStatus, query, onQuery, testCount, showTest, onShowTest,
}) {
  return (
    <div className="inv-toolbar">
      <div className="inv-filter">
        <label htmlFor="status-filter">Status</label>
        <select id="status-filter" value={status} onChange={e => onStatus(e.target.value)}>
          <option value="all">All statuses</option>
          {Object.entries(STATUS_LABELS)
            .filter(([value]) => value !== QUOTED_STATUS)
            .map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
        </select>
      </div>

      {/* type=search rather than text, so a phone shows the right keyboard and
          the browser offers its own clear button. */}
      <div className="inv-filter inv-filter-search">
        <label htmlFor="job-search">Search</label>
        <input
          id="job-search"
          type="search"
          value={query}
          placeholder="Search by name, address or invoice number"
          onChange={e => onQuery(e.target.value)}
        />
      </div>

      {query.trim() !== '' && (
        <button type="button" className="btn-cancel btn-small" onClick={() => onQuery('')}>
          Clear
        </button>
      )}

      {testCount > 0 && (
        <label className="inv-filter jobs-show-test">
          <input type="checkbox" checked={showTest} onChange={e => onShowTest(e.target.checked)} />
          {' '}Show test jobs ({testCount})
        </label>
      )}
    </div>
  )
}
