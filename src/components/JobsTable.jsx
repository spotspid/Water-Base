import { formatCurrency } from '../lib/inventory'
import { STATUS_LABELS } from '../lib/constants'
import { agreementLabel, agreementTone } from '../lib/agreements'
import { GROSS, NOT_COSTED, basisTag, canShowProfit } from '../lib/profit'

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
export default function JobsTable({ jobs, onOpen }) {
  return (
        <div className="table-wrap">
          <table className="jobs-table jobs-list">
            <thead>
              <tr>
                <th>Customer</th>
                <th>System</th>
                <th className="col-num">Price</th>
                <th className="col-num">Parts</th>
                <th className="col-num">Pay</th>
                <th className="col-num">{GROSS}</th>
                <th>Status</th>
                <th>Agreement</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
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
                  <td className="col-num">{formatCurrency(job.installer_pay)}</td>
                  <td className={Number(job.margin) < 0 ? 'col-num col-value job-margin-bad' : 'col-num col-value'}>
                    {canShowProfit(job.parts_cost_basis) && job.margin != null ? (
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
                         dressed up as profit. */
                      <span className="cell-unset">{NOT_COSTED}</span>
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
                    {new Date(job.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
  )
}
