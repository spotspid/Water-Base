import { formatCurrency } from '../lib/inventory'
import StatGrid from './StatGrid'

// The four figures over the jobs table.
//
// The first used to be called revenue, and Profit and loss calls installed
// revenue by the same name. They are different numbers: this one is the sum
// of every open and finished contract, and only the installed part has been
// earned. So it is contracted value here, and revenue stays with the page
// that counts delivered jobs.
//
// Margin carries a caveat for the same reason. A job that is sold or
// scheduled has drawn no parts yet, so its margin reads as its whole price
// and the percentage says 100. The note says how many jobs are in that state
// so the figure is read as "so far" rather than as the answer.
export default function JobsSummary({ totals, undeducted }) {
  return (
    <StatGrid count={4}>
      <div className="inv-stat inv-stat-lead">
        <span className="inv-stat-label">Margin so far</span>
        <span className="inv-stat-value">{formatCurrency(totals.margin)}</span>
        <span className="inv-stat-note">
          {undeducted === 0
            ? 'Parts deducted on every job counted'
            : `Before parts on ${undeducted} ${undeducted === 1 ? 'job' : 'jobs'} not yet installed`}
        </span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-label">Contracted value</span>
        <span className="inv-stat-value">{formatCurrency(totals.revenue)}</span>
        <span className="inv-stat-note">Sum of job prices, installed or not</span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-label">Parts</span>
        <span className="inv-stat-value">{formatCurrency(totals.parts)}</span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-label">Installer Pay</span>
        <span className="inv-stat-value">{formatCurrency(totals.pay)}</span>
      </div>
    </StatGrid>
  )
}
