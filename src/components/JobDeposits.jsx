import { useCallback, useEffect, useState } from 'react'
import { fetchDeposits, removeDeposit } from '../lib/deposits'
import { balanceState, depositTerm, isRefund, paidShare } from '../lib/depositState'
import { formatCurrency } from '../lib/inventory'
import { formatLongDate } from '../lib/schedule'
import JobDepositForm from './JobDepositForm'
import './Deposits.css'

// What has been paid against this job, and what is left.
//
// Every row is a payment. A deposit, a completion payment, an Affirm
// settlement and a Zelle transfer are the same kind of record, and each one
// draws down the sale price. The deposit agreed at quoting is a term shown
// above them, not a kind of row: it says how much was due at signing, and the
// payments say how much of that has arrived.
//
// Balance due is worked out by the database from the sale price and the
// payments, and is never stored, so it cannot disagree with the figure printed
// on the work order the installer is holding.
export default function JobDeposits({ job, onChanged }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [removingId, setRemovingId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await fetchDeposits(job.id)
    setError(err || '')
    setRows(err ? [] : (data || []))
    setLoading(false)
  }, [job.id])

  useEffect(() => { load() }, [load])

  const balance = balanceState(job)
  const share = paidShare(job)
  const term = depositTerm(job)

  const termLine = !term.recorded
    ? 'No deposit was recorded when this job was quoted. Set one from Edit if there was.'
    : term.none
      ? 'No deposit agreed. The whole price is due on completion.'
      : term.outstanding > 0
        ? `Deposit of ${formatCurrency(term.amount)} agreed, ${formatCurrency(term.outstanding)} of it not yet received.`
        : `Deposit of ${formatCurrency(term.amount)} agreed and received.`

  async function drop(id) {
    setError('')
    setRemovingId('')

    const { error: err } = await removeDeposit(id)

    if (err) {
      setError(err)
      return
    }

    load()
    onChanged()
  }

  function added() {
    setAdding(false)
    load()
    onChanged()
  }

  return (
    <section className="agr-panel">
      <div className="agr-head">
        <div>
          <h3>Payments</h3>
          <p className="agr-sub">
            {balance.taken === 0
              ? `Nothing received yet against ${formatCurrency(balance.price)}.`
              : `${formatCurrency(balance.taken)} received of ${formatCurrency(balance.price)}.`}
          </p>
          <p className={term.outstanding > 0 ? 'agr-sub dep-term dep-term-due' : 'agr-sub dep-term'}>
            {termLine}
          </p>
        </div>
        <span className={`dep-balance dep-balance-${balance.state}`}>
          {balance.state === 'due' && <>{formatCurrency(balance.amount)} due</>}
          {balance.state === 'settled' && <>Paid in full</>}
          {balance.state === 'credit' && <>{formatCurrency(balance.amount)} owed back</>}
        </span>
      </div>

      {share != null && balance.taken > 0 && (
        <div className="dep-bar" role="img"
          aria-label={`${Math.round(share)} percent of the price collected`}>
          <span className="dep-bar-fill" style={{ '--paid-share': `${share}%` }} />
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {loading && <p className="inv-state">Loading payments...</p>}

      {!loading && rows.length > 0 && (
        <ul className="dep-list">
          {rows.map(row => (
            <li key={row.id} className={isRefund(row) ? 'dep-row dep-row-refund' : 'dep-row'}>
              <span className="dep-row-amount">
                {isRefund(row)
                  ? `${formatCurrency(Math.abs(row.amount))} refunded`
                  : formatCurrency(row.amount)}
              </span>
              <span className="dep-row-when">{formatLongDate(String(row.received_on).slice(0, 10))}</span>
              <span className="dep-row-method">
                {row.method || <span className="cell-unset">method not recorded</span>}
              </span>
              <span className="dep-row-note">{row.note}</span>
              {removingId === row.id ? (
                <span className="dep-row-confirm">
                  <button type="button" className="btn-primary btn-mini" onClick={() => drop(row.id)}>
                    Remove
                  </button>
                  <button type="button" className="btn-cancel btn-mini" onClick={() => setRemovingId('')}>
                    Keep
                  </button>
                </span>
              ) : (
                <button type="button" className="dep-row-drop" onClick={() => setRemovingId(row.id)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!loading && rows.length === 0 && !adding && (
        <p className="inv-state">
          No payments recorded yet.
        </p>
      )}

      {adding && (
        <JobDepositForm jobId={job.id} onAdded={added} onCancel={() => setAdding(false)} />
      )}

      {!adding && (
        <div className="agr-actions">
          <button type="button" className="btn-cancel" onClick={() => { setAdding(true); setError('') }}>
            Record a payment
          </button>
        </div>
      )}

      <p className="agr-sub">
        Balance due is the sale price less every payment, whatever it was for, worked out
        fresh every time rather than stored. It prints on the work order so the installer
        collects the right amount instead of asking for the whole price.
      </p>
    </section>
  )
}
