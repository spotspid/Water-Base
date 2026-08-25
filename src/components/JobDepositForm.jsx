import { useState } from 'react'
import { addDeposit } from '../lib/deposits'
import { useSettings, withCurrent } from '../lib/settings'

// Recording one payment.
//
// Amount is a plain number with no suggested value. There is deliberately no
// "30 percent" button and no default, because a default is a rule wearing a
// convenience, and the whole point of this table is that there is no rule.
//
// A negative amount is accepted and reads as a refund. It is the only way to
// record money going back out without deleting the deposit that really came
// in, and the list labels it rather than leaving a bare minus sign.
export default function JobDepositForm({ jobId, onAdded, onCancel }) {
  const { paymentTypes, loading: loadingTypes } = useSettings()
  const [form, setForm] = useState({
    amount: '', received_on: '', method: '', note: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const methods = withCurrent(paymentTypes || [], form.method)
  const amount = Number(form.amount)
  const refund = Number.isFinite(amount) && amount < 0

  function change(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  async function submit(e) {
    e.preventDefault()

    if (form.amount.trim() === '' || !Number.isFinite(amount) || amount === 0) {
      setError('Enter an amount. A negative one records a refund.')
      return
    }
    if (!form.received_on) {
      setError('When was it received?')
      return
    }

    setError('')
    setBusy(true)

    const { error: err } = await addDeposit({
      job_id: jobId,
      amount,
      received_on: form.received_on,
      method: form.method || null,
      note: form.note.trim() || null,
    })

    setBusy(false)

    if (err) {
      setError(err)
      return
    }

    setForm({ amount: '', received_on: '', method: '', note: '' })
    onAdded()
  }

  return (
    <form className="dep-form" onSubmit={submit} noValidate>
      <div className="field dep-amount">
        <label htmlFor="dep-amount">Amount ($)</label>
        <input id="dep-amount" name="amount" type="number" step="0.01"
          value={form.amount} onChange={change} disabled={busy} />
      </div>
      <div className="field dep-date">
        <label htmlFor="dep-date">Received</label>
        <input id="dep-date" name="received_on" type="date"
          value={form.received_on} onChange={change} disabled={busy} />
      </div>
      <div className="field dep-method">
        <label htmlFor="dep-method">Method <span className="optional">(optional)</span></label>
        <select id="dep-method" name="method" value={form.method}
          onChange={change} disabled={busy || loadingTypes}>
          <option value="">{loadingTypes ? 'Loading...' : 'Not recorded'}</option>
          {methods.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div className="field dep-note">
        <label htmlFor="dep-note">Note <span className="optional">(optional)</span></label>
        <input id="dep-note" name="note" type="text"
          value={form.note} onChange={change} disabled={busy} />
      </div>

      <div className="dep-form-actions">
        <button type="submit" className="btn-primary btn-mini" disabled={busy}>
          {busy ? 'Saving...' : refund ? 'Record refund' : 'Record deposit'}
        </button>
        <button type="button" className="btn-cancel btn-mini" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {refund && (
          <span className="dep-refund-hint">
            A negative amount goes back to the customer and puts the balance back up.
          </span>
        )}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
    </form>
  )
}
