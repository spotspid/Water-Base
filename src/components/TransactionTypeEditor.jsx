import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { DIRECTION_LABELS } from '../lib/settings'
import TransactionTypeModal from './TransactionTypeModal'

export default function TransactionTypeEditor({ types, onChanged }) {
  const [editing, setEditing] = useState(null)
  const [busyValue, setBusyValue] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function run(value, message, work) {
    setError('')
    setNotice('')
    setBusyValue(value)

    const { error: err } = await attempt(work, 'That transaction type could not be saved.')

    if (err) {
      setError(err)
      setBusyValue('')
      return
    }

    setBusyValue('')
    setNotice(message)
    onChanged()
  }

  function handleSaved(message) {
    setEditing(null)
    setError('')
    setNotice(message)
    onChanged()
  }

  async function handleToggle(type) {
    await run(
      type.value,
      type.active ? `"${type.label}" is off and will not appear when logging.` : `"${type.label}" is back on.`,
      () => supabase.from('transaction_types').update({ active: !type.active }).eq('value', type.value),
    )
  }

  async function handleRemove(type) {
    await run(type.value, `Removed "${type.label}".`, () =>
      supabase.from('transaction_types').delete().eq('value', type.value))
  }

  return (
    <section className="set-card">
      <header className="set-card-head">
        <div>
          <h2>Transaction types</h2>
          <p className="set-card-desc">
            The vocabulary of the inventory ledger. Direction decides whether logging one
            adds to or removes from stock. Built in types are written by the app itself, so
            their code and direction are fixed, though their wording is yours.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => setEditing({})}>
          + Add type
        </button>
      </header>

      {types.length === 0 && (
        <p className="set-empty">No transaction types exist, so nothing can be logged.</p>
      )}

      {types.length > 0 && (
        <div className="table-wrap">
          <table className="jobs-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Code</th>
                <th>Direction</th>
                <th>Help Text</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {types.map(type => (
                <tr key={type.value} className={type.active ? '' : 'set-row-off'}>
                  <td className="td-customer">
                    {type.label}
                    {type.is_system && <span className="set-system-badge">Built in</span>}
                    {!type.active && <span className="inv-inactive">Off</span>}
                  </td>
                  <td className="col-sku">{type.value}</td>
                  <td>
                    <span className={Number(type.direction) < 0 ? 'qty-out' : 'qty-in'}>
                      {DIRECTION_LABELS[String(type.direction)] || type.direction}
                    </span>
                  </td>
                  <td className="tpl-detail">{type.help || ''}</td>
                  <td className="col-actions">
                    <span className="tpl-confirm">
                      <button type="button" className="tpl-link" disabled={busyValue === type.value}
                        onClick={() => setEditing(type)}>
                        Edit
                      </button>
                      {!type.is_system && (
                        <>
                          <button type="button" className="tpl-link" disabled={busyValue === type.value}
                            onClick={() => handleToggle(type)}>
                            {type.active ? 'Turn off' : 'Turn on'}
                          </button>
                          <button type="button" className="tpl-danger" disabled={busyValue === type.value}
                            onClick={() => handleRemove(type)}>
                            Remove
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="set-notice" role="status">{notice}</p>}

      {editing && (
        <TransactionTypeModal
          type={editing.value ? editing : null}
          existing={types}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
    </section>
  )
}
