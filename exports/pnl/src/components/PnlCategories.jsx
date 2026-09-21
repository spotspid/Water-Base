import { formatCurrency, formatMonthShort } from '../lib/expenses'

// Expenses by category, one column per month. This is the expense_total column
// of the monthly table opened up, so the two always agree by construction.
//
// loadError is the page saying the breakdown query failed. That is not the
// same as no expenses, and the card must not pretend it is.
export default function PnlCategories({ months, rows, loadError, onRetry }) {
  if (loadError) {
    return (
      <section className="set-card">
        <header className="set-card-head">
          <div>
            <h2>Expenses by category</h2>
            <p className="set-card-desc">The breakdown could not be loaded.</p>
          </div>
        </header>
        <div className="form-error" role="alert">
          <p>{loadError}</p>
          <button type="button" className="btn-cancel" onClick={onRetry}>Try again</button>
        </div>
      </section>
    )
  }

  if (rows.length === 0) {
    return (
      <section className="set-card">
        <header className="set-card-head">
          <div>
            <h2>Expenses by category</h2>
            <p className="set-card-desc">No expenses fall in this range.</p>
          </div>
        </header>
      </section>
    )
  }

  const categories = [...new Set(rows.map(r => r.category))].sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' }))

  const cell = new Map()
  for (const row of rows) {
    cell.set(`${row.category}|${row.month}`, Number(row.total))
  }

  const rowTotal = category =>
    months.reduce((sum, m) => sum + (cell.get(`${category}|${m}`) || 0), 0)

  const columnTotal = month =>
    categories.reduce((sum, c) => sum + (cell.get(`${c}|${month}`) || 0), 0)

  const grandTotal = categories.reduce((sum, c) => sum + rowTotal(c), 0)

  return (
    <section className="set-card">
      <header className="set-card-head">
        <div>
          <h2>Expenses by category</h2>
          <p className="set-card-desc">
            The same money as the expenses column above, grouped by what it was spent on.
          </p>
        </div>
        <span className="set-count">{formatCurrency(grandTotal)}</span>
      </header>

      <div className="table-wrap">
        <table className="jobs-table pnl-table">
          <thead>
            <tr>
              <th>Category</th>
              {months.map(m => (
                <th key={m} className="col-num">{formatMonthShort(m)}</th>
              ))}
              <th className="col-num">Total</th>
            </tr>
          </thead>
          <tbody>
            {categories.map(category => (
              <tr key={category}>
                <td className="td-customer">{category}</td>
                {months.map(m => {
                  const value = cell.get(`${category}|${m}`)
                  return (
                    <td key={m} className="col-num">
                      {value == null ? <span className="pnl-blank">.</span> : formatCurrency(value)}
                    </td>
                  )
                })}
                <td className="col-num col-value">{formatCurrency(rowTotal(category))}</td>
              </tr>
            ))}
            <tr className="pnl-total-row">
              <td className="td-customer">All categories</td>
              {months.map(m => (
                <td key={m} className="col-num col-value">{formatCurrency(columnTotal(m))}</td>
              ))}
              <td className="col-num col-value">{formatCurrency(grandTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
