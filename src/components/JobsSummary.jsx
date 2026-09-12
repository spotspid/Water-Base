import { formatCurrency } from '../lib/inventory'
import { GROSS, totalsNote } from '../lib/profit'
import StatGrid from './StatGrid'

// The four figures over the jobs table.
//
// Contracted value is not revenue. Profit and loss calls installed work by
// that name, and this is the sum of every open and finished contract, only
// part of which has been earned. Keeping the two words apart is what stops the
// pages being read as disagreeing.
//
// The profit figure used to be every job's price less whatever the ledger had
// deducted, which for a job that had not installed was nothing. Eight jobs
// therefore contributed their entire sale price and the bar read 30,080
// against a real figure of 1,838. It now adds the settled jobs to the ones
// whose parts list resolves in full, says how many of each, and leaves out
// anything not costed rather than counting it as pure profit.
export default function JobsSummary({ totals }) {
  return (
    <StatGrid count={4}>
      <div className="inv-stat inv-stat-lead">
        <span className="inv-stat-label">{GROSS}</span>
        <span className="inv-stat-value">{formatCurrency(totals.combined)}</span>
        <span className="inv-stat-note">{totalsNote(totals)}</span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-label">Contracted value</span>
        <span className="inv-stat-value">{formatCurrency(totals.revenue)}</span>
        <span className="inv-stat-note">Sum of job prices, installed or not</span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-label">Parts</span>
        <span className="inv-stat-value">{formatCurrency(totals.parts)}</span>
        <span className="inv-stat-note">Deducted where installed, expected where not</span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-label">Installer Pay</span>
        <span className="inv-stat-value">{formatCurrency(totals.pay)}</span>
      </div>
    </StatGrid>
  )
}
