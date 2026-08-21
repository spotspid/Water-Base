import { formatCurrency, formatDate, sumAmounts } from '../lib/expenses'

// Step three. Every row that will land, every row that will not, and which of
// them look like something already recorded. Duplicates are flagged and still
// committed, because a repeat charge from the same supplier on the same day
// is a normal thing that happens.
export default function ImportPreviewStep({ rows, problems, duplicates, category }) {
  const total = sumAmounts(rows)
  const flagged = rows.filter((_, i) => duplicates.has(i) || rows[i].repeatOfLine)

  return (
    <div className="imp-step">
      <div className="imp-summary">
        <div className="inv-stat inv-stat-lead">
          <span className="inv-stat-label">Rows to import</span>
          <span className="inv-stat-value">{rows.length}</span>
        </div>
        <div className="inv-stat">
          <span className="inv-stat-label">Total</span>
          <span className="inv-stat-value">{formatCurrency(total)}</span>
        </div>
        <div className={flagged.length > 0 ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
          <span className="inv-stat-label">Possible duplicates</span>
          <span className="inv-stat-value">{flagged.length}</span>
        </div>
        <div className={problems.length > 0 ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
          <span className="inv-stat-label">Skipped</span>
          <span className="inv-stat-value">{problems.length}</span>
        </div>
      </div>

      {flagged.length > 0 && (
        <p className="form-warning" role="status">
          {flagged.length} {flagged.length === 1 ? 'row matches an expense' : 'rows match expenses'}
          {' '}already recorded, on date plus amount plus vendor. They are flagged below and
          will still be imported unless you go back and change the file.
        </p>
      )}

      {rows.length === 0 && (
        <p className="form-error" role="alert">
          No rows could be read with the current mapping. Go back and check the columns.
        </p>
      )}

      {rows.length > 0 && (
        <div className="table-wrap imp-scroll">
          <table className="jobs-table imp-table">
            <thead>
              <tr>
                <th>Line</th>
                <th>Date</th>
                <th className="col-num">Amount</th>
                <th>Vendor</th>
                <th>Description</th>
                <th>Category</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const hit = duplicates.get(index)
                const repeat = row.repeatOfLine
                return (
                  <tr key={index} className={hit || repeat ? 'imp-row-flagged' : ''}>
                    <td className="col-sku">{row.lineNumber}</td>
                    <td className="col-nowrap">{formatDate(row.spent_on)}</td>
                    <td className={row.amount < 0 ? 'col-num qty-out' : 'col-num'}>
                      {formatCurrency(row.amount)}
                    </td>
                    <td>{row.vendor || ''}</td>
                    <td className="col-note">{row.description || ''}</td>
                    <td>{category}</td>
                    <td>
                      {hit && (
                        <span className="inv-low" title={`Matches an expense dated ${formatDate(hit.sampleSpentOn)}`}>
                          On file
                        </span>
                      )}
                      {repeat && (
                        <span className="inv-low" title={`Same as line ${repeat} in this file`}>
                          Line {repeat}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {problems.length > 0 && (
        <div className="imp-problems">
          <p className="imp-sample-title">
            Skipped rows, which will not be imported
          </p>
          <ul className="imp-problem-list">
            {problems.slice(0, 25).map(p => (
              <li key={p.lineNumber}>
                <strong>Line {p.lineNumber}</strong> {p.reason}
              </li>
            ))}
          </ul>
          {problems.length > 25 && (
            <p className="field-hint">and {problems.length - 25} more.</p>
          )}
        </div>
      )}
    </div>
  )
}
