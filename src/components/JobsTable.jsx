import { formatCurrency } from '../lib/inventory'
import { STATUS_LABELS } from '../lib/constants'
import { agreementLabel, agreementTone } from '../lib/agreements'
import {
  PAY_UNSET, basisTag, canShowProfit, isKnownAmount, notCostedLabel,
} from '../lib/profit'
import { jobListDate } from '../lib/jobDates'
import { JOB_SORTS, ariaSortOf } from '../lib/jobSort'

// The jobs list itself.
//
// Split out of the page so Jobs.jsx stays about loading, filtering and which
// job is open, and so the two cells that carry the profit rules are somewhere
// findable. Those two are the point of this file:
//
// Parts shows the ledger figure once a job has installed and the resolved
// parts list before that, and never a zero standing in for "nobody has costed
// this yet".
//
// Gross profit shows a number only when something is behind it. A job whose
// parts list cannot name every part reads "Not costed yet" rather than its
// whole sale price, which is what used to make this table's total sixteen
// times the one on Profit and loss.
//
// reasonFor, when a named list passes it, puts that list's reason under each
// customer name, so a filtered list says why every row is on it.
export default function JobsTable({ jobs, onOpen, reasonFor, sort, onSort }) {
  return (
        <div className="table-wrap">
          <table className="jobs-table jobs-list">
            <thead>
              <tr>
                <SortHead col="customer" sort={sort} onSort={onSort} />
                <SortHead col="sheet" sort={sort} onSort={onSort} />
                <SortHead col="price" sort={sort} onSort={onSort} numeric />
                <SortHead col="parts" sort={sort} onSort={onSort} numeric />
                <SortHead col="pay" sort={sort} onSort={onSort} numeric />
                <SortHead col="profit" sort={sort} onSort={onSort} numeric />
                <SortHead col="status" sort={sort} onSort={onSort} />
                <SortHead col="agreement" sort={sort} onSort={onSort} />
                <SortHead col="date" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => { const when = jobListDate(job); return (
                <tr key={job.id} className="inv-row" tabIndex={0}
                  onClick={() => onOpen(job.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpen(job.id)
                    }
                  }}>
                  <td className="td-customer">
                    {job.customer_name}
                    <span className="cell-sub">
                      {job.city || <span className="cell-unset">City not set</span>}
                    </span>
                    {reasonFor && reasonFor(job) && (
                      <span className="cell-sub job-row-reason">{reasonFor(job)}</span>
                    )}
                  </td>
                  <td>{job.system_template}</td>
                  <td className="col-num">{formatCurrency(job.sale_price)}</td>
                  <td className="col-num">
                    {/* The ledger figure once it has installed, the resolved
                        list before that, and never a zero standing in for
                        "nobody has costed this". */}
                    {job.parts_cost_effective == null ? (
                      <span className="cell-unset">not costed</span>
                    ) : (
                      <>
                        {formatCurrency(job.parts_cost_effective)}
                        {basisTag(job.parts_cost_basis) && (
                          <span className="cell-basis">{basisTag(job.parts_cost_basis)}</span>
                        )}
                      </>
                    )}
                    {job.status === 'installed' && !job.parts_deducted_at && (
                      <span className="inv-low" title="Installed without a template deduction">Manual</span>
                    )}
                  </td>
                  <td className="col-num">
                    {/* A payout of nothing is a decision. No payout at all is
                        a blank, and printing $0.00 for it made a job look
                        costed when nobody had costed it. */}
                    {isKnownAmount(job.installer_pay)
                      ? formatCurrency(job.installer_pay)
                      : <span className="cell-unset">{PAY_UNSET}</span>}
                  </td>
                  <td className={Number(job.margin) < 0 ? 'col-num col-value job-margin-bad' : 'col-num col-value'}>
                    {canShowProfit(job.profit_basis) && job.margin != null ? (
                      <>
                        {formatCurrency(job.margin)}
                        {job.margin_pct != null && (
                          <span className="job-margin-pct">{Number(job.margin_pct).toFixed(0)}%</span>
                        )}
                        {basisTag(job.parts_cost_basis) && (
                          <span className="cell-basis">{basisTag(job.parts_cost_basis)}</span>
                        )}
                      </>
                    ) : (
                      /* A blank that says so, rather than the whole sale price
                         dressed up as profit, and which of the two blanks it
                         is waiting on. */
                      <span className="cell-unset">{notCostedLabel(job.profit_basis)}</span>
                    )}
                  </td>
                  <td>
                    <span className={`status-badge status-${job.status}`}>
                      {STATUS_LABELS[job.status] || job.status}
                    </span>
                  </td>
                  <td>
                    <span className={`agr-badge agr-${agreementTone(job)}`}>
                      {agreementLabel(job)}
                    </span>
                  </td>
                  <td className="col-nowrap">
                    {when.date.toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                    <span className="cell-sub">{when.kind}</span>
                  </td>
                </tr>
              ) })}
            </tbody>
          </table>
        </div>
  )
}

// One column heading, as the button that sorts by it.
//
// A button inside the th rather than a click handler on the th itself, so it
// is reachable by keyboard and announced as a control. aria-sort tells a
// screen reader which column is doing the sorting and which way, and the
// arrow says the same thing to everyone else.
function SortHead({ col, sort, onSort, numeric }) {
  const spec = JOB_SORTS[col]
  const active = sort?.column === col
  const arrow = active ? (sort.direction === 'asc' ? '\u2191' : '\u2193') : ''

  return (
    <th className={numeric ? 'col-num' : undefined} aria-sort={ariaSortOf(col, sort)}>
      <button type="button" className={active ? 'th-sort th-sort-on' : 'th-sort'}
        onClick={() => onSort(col)}>
        {spec.label}
        <span className="th-sort-arrow" aria-hidden="true">{arrow}</span>
      </button>
    </th>
  )
}
