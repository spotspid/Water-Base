import { Link } from 'react-router-dom'
import { useSettings } from '../lib/settings'
import { costEffect } from '../lib/dashboard'
import { formatCurrency, formatDateTime, formatDay, formatSignedQty } from '../lib/inventory'

// The last few things that moved through the ledger, as a feed.
//
// It was a six column table, which made four events look like a report. The
// question this answers is "what has been happening", and that reads better as
// a list of things than as a grid to scan.
//
// One job is one entry. Installing a Flagship Bundle writes a row per part, so
// this used to show a single install five times over. The five are folded into
// one line that says what the job took, and the Ledger has every row for
// anyone who needs them.
//
// The square on the left carries direction, which is the fact you want first:
// out of stock, into stock, or an adjustment nobody has categorised. Colour
// says it fastest and the sign says it at all, so both are always present.
export default function DashboardActivity({ entries, limit, totalEntries }) {
  const { allTxnTypes } = useSettings()

  function typeLabel(value) {
    return allTxnTypes.find(t => t.value === value)?.label || value
  }

  return (
    <section className="dash-panel">
      <header className="dash-panel-head">
        <h2>Recent stock movement</h2>
        <span className="dash-panel-note">
          Every change is a ledger entry, nothing is edited in place
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
        <ul className="mv-feed">
          {entries.map(entry => (
            <MovementRow key={entry.key} entry={entry} typeLabel={typeLabel} />
          ))}
        </ul>
      )}

      {totalEntries > limit && (
        <p className="dash-panel-foot">
          {totalEntries - limit} older {totalEntries - limit === 1 ? 'entry' : 'entries'} are on
          the <Link to="/inventory" className="tpl-link">ledger</Link>.
        </p>
      )}
    </section>
  )
}

/**
 * Which way stock moved.
 *
 * An adjustment is its own direction rather than being filed as an out. It
 * means somebody moved stock without recording why, which is a different
 * thing from an install drawing parts, and colouring the two alike would hide
 * the one worth chasing.
 */
function directionOf(entry) {
  const quantity = entry.single ? Number(entry.row.quantity) || 0 : Number(entry.quantity) || 0
  const type = entry.single ? entry.row.txn_type : entry.txnType

  if (type === 'adjustment') return 'adj'
  return quantity < 0 ? 'out' : 'in'
}

const SIGN = { out: '−', in: '+', adj: '±' }

function MovementRow({ entry, typeLabel }) {
  const single = entry.single
  const row = entry.row
  const direction = directionOf(entry)
  const quantity = single ? Number(row.quantity) || 0 : Number(entry.quantity) || 0
  const value = single ? costEffect(row) : entry.value

  const title = single
    ? (row.inventory_items?.name || 'Unknown item')
    : `${entry.lineCount} parts for ${entry.customerName || 'one job'}`

  const detail = single
    ? [
      row.inventory_items?.sku,
      row.inventory_items?.variant,
      row.jobs?.customer_name || row.note || typeLabel(row.txn_type),
    ].filter(Boolean).join(', ')
    : `${entry.units} units ${entry.quantity < 0 ? 'drawn' : 'returned'} when the job was `
      + `marked ${entry.quantity < 0 ? 'installed' : 'reopened'}`

  return (
    <li className="mv">
      <span className={`mv-i mv-i-${direction}`} aria-hidden="true">{SIGN[direction]}</span>

      <span className="mv-b">
        <span className="mv-t">{title}</span>
        {detail && <span className="mv-s">{detail}</span>}
      </span>

      <span className="mv-r">
        <span className={`mv-q mv-q-${direction}`}>{formatSignedQty(quantity)}</span>
        <span className="mv-v">{formatCurrency(Math.abs(value))}</span>
      </span>

      <span className="mv-w" title={formatDateTime(row.created_at)}>
        {formatDay(row.created_at)}
      </span>
    </li>
  )
}
