import { useState } from 'react'
import { reverseBatch } from '../lib/importPipeline'
import { formatCurrency, formatDate } from '../lib/expenses'
import { formatDateTime } from '../lib/inventory'

// Every import that has been committed, newest first, with the one action a
// batch supports. A reversed batch keeps its row so the history stays honest
// rather than leaving an unexplained gap.
export default function ExpenseBatches({ batches, onChanged }) {
  const [confirmId, setConfirmId] = useState('')
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  async function handleReverse(batch) {
    setError('')
    setBusyId(batch.id)

    const { error: err } = await reverseBatch(batch.id)

    setBusyId('')
    setConfirmId('')

    if (err) {
      setError(err)
      return
    }

    onChanged()
  }

  if (batches.length === 0) {
    return (
      <section className="set-card">
        <header className="set-card-head">
          <div>
            <h2>Imports</h2>
            <p className="set-card-desc">
              Nothing has been imported yet. A committed import appears here and can be
              reversed as a unit.
            </p>
          </div>
        </header>
      </section>
    )
  }

  return (
    <section className="set-card">
      <header className="set-card-head">
        <div>
          <h2>Imports</h2>
          <p className="set-card-desc">
            Each import is one batch. Reversing removes every expense it created, and
            leaves the batch listed as reversed.
          </p>
        </div>
        <span className="set-count">{batches.length}</span>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="table-wrap">
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Imported</th>
              <th>Source</th>
              <th>File</th>
              <th className="col-num">Rows</th>
              <th className="col-num">Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {batches.map(batch => {
              const reversed = Boolean(batch.reversed_at)
              const confirming = confirmId === batch.id
              const busy = busyId === batch.id

              return (
                <tr key={batch.id}>
                  <td className="col-nowrap">{formatDateTime(batch.created_at)}</td>
                  <td><span className="txn-badge txn-purchase">{batch.source}</span></td>
                  <td className="col-note">{batch.filename || ''}</td>
                  <td className="col-num">{batch.row_count}</td>
                  <td className="col-num col-value">{formatCurrency(batch.total_amount)}</td>
                  <td>
                    {reversed
                      ? <span className="inv-inactive">Reversed {formatDate(batch.reversed_at)}</span>
                      : <span className="txn-badge txn-adjustment">Active</span>}
                  </td>
                  <td className="col-num">
                    {reversed ? null : confirming ? (
                      <span className="bat-confirm">
                        <button type="button" className="btn-danger" disabled={busy}
                          onClick={() => handleReverse(batch)}>
                          {busy ? 'Reversing...' : `Remove ${batch.row_count}`}
                        </button>
                        <button type="button" className="tpl-link" disabled={busy}
                          onClick={() => setConfirmId('')}>
                          Keep
                        </button>
                      </span>
                    ) : (
                      <button type="button" className="btn-cancel" disabled={Boolean(busyId)}
                        onClick={() => { setConfirmId(batch.id); setError('') }}>
                        Reverse
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
