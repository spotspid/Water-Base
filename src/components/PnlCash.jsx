import { formatCurrency, formatMonth } from '../lib/expenses'

// Cash, kept in its own section rather than as two more columns on the profit
// and loss table.
//
// The separation is the whole point. A deposit is not extra income; it is the
// same money as part of the sale price, arriving earlier. Put it next to
// revenue and somebody eventually adds the two together, and the month a
// customer pays half up front starts looking like a month the business earned
// half again as much.
//
// Nothing here feeds net. Net is above, and it is an accrual figure.
export default function PnlCash({ months }) {
  const rows = months.filter(m => Number(m.cash_in) !== 0 || Number(m.deposits_in) !== 0)

  if (rows.length === 0) return null

  const totals = rows.reduce((acc, m) => ({
    deposits: acc.deposits + Number(m.deposits_in),
    balance: acc.balance + Number(m.balance_on_install),
    cash: acc.cash + Number(m.cash_in),
    count: acc.count + Number(m.deposit_count),
  }), { deposits: 0, balance: 0, cash: 0, count: 0 })

  return (
    <section className="pnl-cash">
      <header className="pnl-cash-head">
        <h2>Cash received</h2>
        <span className="pnl-cash-note">
          Not income. This is the same money as the revenue above, counted on the day it
          arrived rather than the day it was earned.
        </span>
      </header>

      <div className="table-wrap">
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="col-num">Deposits taken</th>
              <th className="col-num">Balance on install</th>
              <th className="col-num">Cash in</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.month}>
                <td className="td-customer col-nowrap">{formatMonth(row.month)}</td>
                <td className="col-num">
                  {formatCurrency(row.deposits_in)}
                  {Number(row.deposit_count) > 0 && (
                    <span className="cell-sub">
                      {row.deposit_count} {Number(row.deposit_count) === 1 ? 'payment' : 'payments'}
                    </span>
                  )}
                </td>
                <td className="col-num">{formatCurrency(row.balance_on_install)}</td>
                <td className="col-num col-value">{formatCurrency(row.cash_in)}</td>
              </tr>
            ))}
            <tr className="pnl-total-row">
              <td className="td-customer">Range total</td>
              <td className="col-num col-value">{formatCurrency(totals.deposits)}</td>
              <td className="col-num col-value">{formatCurrency(totals.balance)}</td>
              <td className="col-num col-value">{formatCurrency(totals.cash)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="inv-ledger-note">
        Deposits taken is what customers actually handed over that month. Balance on
        install is the rest of the price on jobs installed that month, which is the sale
        price less every deposit already taken against that job. Added over a job&apos;s
        whole life the two come to its sale price exactly once, so a deposit is never
        counted twice when the job is finished and paid off.
        {' '}Nothing was recorded for the payment taken at the door, so an installed job
        is treated as paid in full. A job that installs still owing money shows that on
        its own record as a balance due.
      </p>
    </section>
  )
}
