import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useSettings } from '../lib/settings'
import { formatCurrency, formatDateTime, formatDay, formatSignedQty } from '../lib/inventory'
import DashboardActivityRow from './DashboardActivityRow'

// The last few things that moved through the ledger.
//
// One job is one entry. Installing a Flagship Bundle writes a row per part, so
// this panel used to show a single install five times over and nothing else,
// which answered "what happened once" rather than "what has been happening".
// The five are folded into one line that says what the job took, and open to
// show the parts for anyone who wants them.
//
// The When column shows the day rather than a clock time. The ledger's grain
// is the day, and several rows were back loaded from an invoice date with no
// real time attached, so printing one would be inventing it. The full instant
// is on the cell's tooltip.
//
// Reason is left blank when there is nothing to say. It used to fall back to
// "Manual entry", which was true of almost every row and so told nobody
// anything while making the column look full.
export default function DashboardActivity({ entries, limit, totalEntries }) {
  const { allTxnTypes } = useSettings()
  const [open, setOpen] = useState(() => new Set())

  function typeLabel(value) {
    return allTxnTypes.find(t => t.value === value)?.label || value
  }

  function reason(row) {
    if (row.jobs?.customer_name) {
      return row.source === 'manual'
        ? row.jobs.customer_name
        : `${row.jobs.customer_name}, auto`
    }
    return row.note || ''
  }

  function toggle(key) {
    setOpen(current => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Recent activity</h2>
        <span className="dash-panel-note">
          Every stock change is a ledger entry, nothing is edited in place
        </span>
        <Link to="/inventory" className="tpl-link">Ledger</Link>
      </header>

      {entries.length === 0 && (
        <p className="inv-state">
          Nothing has moved through the inventory ledger yet. Logging a purchase or installing
          a job will show up here.
        </p>
      )}

      {entries.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Part</th>
                <th>Type</th>
                <th className="col-num">Qty</th>
                <th className="col-num">Value</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => {
                if (entry.single) {
                  return (
                    <DashboardActivityRow key={entry.key} row={entry.row}
                      typeLabel={typeLabel} reason={reason} />
                  )
                }

                const expanded = open.has(entry.key)
                const who = entry.customerName || 'one job'

                return [
                  <tr key={entry.key} className="dash-act-group">
                    <td className="col-nowrap" title={formatDateTime(entry.row.created_at)}>
                      {formatDay(entry.row.created_at)}
                    </td>
                    <td className="td-customer">
                      <button type="button" className="dash-act-toggle"
                        aria-expanded={expanded} onClick={() => toggle(entry.key)}>
                        <span className={expanded ? 'dash-act-caret on' : 'dash-act-caret'} aria-hidden="true" />
                        {entry.lineCount} parts for {who}
                      </button>
                      <span className="cell-sub">
                        {entry.units} {entry.units === 1 ? 'unit' : 'units'} in one movement
                      </span>
                    </td>
                    <td>
                      {entry.txnType
                        ? <span className={`txn-badge txn-${entry.txnType}`}>{typeLabel(entry.txnType)}</span>
                        : <span className="txn-badge">Mixed</span>}
                    </td>
                    <td className={entry.quantity < 0 ? 'col-num qty-out' : 'col-num qty-in'}>
                      {formatSignedQty(entry.quantity)}
                    </td>
                    <td className={entry.value < 0 ? 'col-num col-value qty-out' : 'col-num col-value qty-in'}>
                      {formatCurrency(entry.value)}
                    </td>
                    <td className="col-note">
                      {entry.customerName}{entry.auto ? ', auto' : ''}
                    </td>
                  </tr>,
                  ...(expanded ? entry.rows.map(row => (
                    <DashboardActivityRow key={row.id} row={row}
                      typeLabel={typeLabel} reason={reason} nested />
                  )) : []),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}

      {entries.length > 0 && (
        <p className="dash-panel-foot">
          {totalEntries > limit
            ? `The ${limit} most recent movements.`
            : `${entries.length === 1 ? 'The only movement' : `All ${entries.length} movements`} so far.`}
          {' '}A job's parts are one movement, however many lines it wrote. Value is what each
          one did to the money tied up in stock, at the cost stamped on that row.
        </p>
      )}
    </section>
  )
}
