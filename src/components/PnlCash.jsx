import { Link } from 'react-router-dom'
import { formatCurrency, formatMonth } from '../lib/expenses'

// Cash, kept in its own section rather than as more columns on the profit and
// loss table.
//
// The separation is the whole point. A payment is not extra income; it is the
// same money as the sale price, arriving on its own schedule. Put it next to
// revenue and somebody eventually adds the two together.
//
// Cash in is only money that arrived. It used to add the unpaid balance of
// every job installed that month, on the assumption the installer collected it
// at the door, so Walter Radu read as 2,999 collected while his own record said
// he owed 2,999. What is still owed is shown beside cash and never added to it.
//
// deposits_in and deposit_count are the view's names for every payment, kept
// so the page deployed before this change kept working.
//
// Nothing here feeds net. Net is above, and it is an accrual figure.
export default function PnlCash({ months }) {
  const rows = months.filter(m => Number(m.cash_in) !== 0
    || Number(m.deposits_in) !== 0 || Number(m.balance_on_install) !== 0)

  if (rows.length === 0) return null

  const totals = rows.reduce((acc, m) => ({
    owed: acc.owed + Number(m.balance_on_install),
    cash: acc.cash + Number(m.cash_in),
    count: acc.count + Number(m.deposit_count),
  }), { owed: 0, cash: 0, count: 0 })

  return (
    <section className="pnl-cash">
      <header className="pnl-cash-head">
        <h2>Cash</h2>
        <span className="pnl-cash-note">
          Not income. Cash in is money that arrived that month. Still owed is what jobs
          installed that month have not paid yet, and it is not added to anything.
        </span>
      </header>

      <div className="table-wrap">
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="col-num">Cash in</th>
              <th className="col-num">Still owed on installs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.month}>
                <td className="td-customer col-nowrap">{formatMonth(row.month)}</td>
                <td className="col-num col-value">
                  {formatCurrency(row.cash_in)}
                  {Number(row.deposit_count) > 0 && (
                    <span className="cell-sub">
                      {row.deposit_count} {Number(row.deposit_count) === 1 ? 'payment' : 'payments'}
                    </span>
                  )}
                </td>
                <td className={Number(row.balance_on_install) > 0 ? 'col-num qty-out' : 'col-num'}>
                  {formatCurrency(row.balance_on_install)}
                </td>
              </tr>
            ))}
            <tr className="pnl-total-row">
              <td className="td-customer">Range total</td>
              <td className="col-num col-value">{formatCurrency(totals.cash)}</td>
              <td className={totals.owed > 0 ? 'col-num col-value qty-out' : 'col-num col-value'}>
                {formatCurrency(totals.owed)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="inv-ledger-note">
        Every payment counts here on the day it was received, whatever it was for: a
        deposit, a completion payment, Affirm or Zelle. Still owed is today&apos;s figure for
        the jobs installed in each month, the sale price less every payment against the job,
        so it falls as payments come in. The full list, including deposits due on jobs not
        yet installed, is on <Link to="/outstanding" className="tpl-link">Outstanding</Link>.
      </p>
    </section>
  )
}
