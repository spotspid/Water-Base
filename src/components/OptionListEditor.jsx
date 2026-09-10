import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt, attemptRows } from '../lib/errors'
import { lowerLabel, singularise, withArticle } from '../lib/text'

// One editable pick list. The same component drives inventory categories,
// service cities, faucet finishes and payment types, because all four are
// plain text that lands directly on a job or an inventory item.
export default function OptionListEditor({ listKey, title, description, rows, onChanged }) {
  const [adding, setAdding] = useState('')
  const [editingId, setEditingId] = useState('')
  const [draft, setDraft] = useState('')
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  function reset(message) {
    setEditingId('')
    setDraft('')
    setBusyId('')
    setError('')
    setNotice(message || '')
    onChanged()
  }

  async function run(id, label, work) {
    setError('')
    setNotice('')
    setBusyId(id)

    // Every change here is an insert, update or delete on one row, and a
    // rename or removal that matched nothing must not report success.
    const { error: err } = await attemptRows(
      work,
      `That ${singularise(lowerLabel(title))} change could not be saved.`,
    )

    if (err) {
      setError(err)
      setBusyId('')
      return false
    }

    reset(label)
    return true
  }

  async function handleAdd(e) {
    e.preventDefault()
    const value = adding.trim()

    if (!value) {
      setError('Type a value first.')
      return
    }
    if (rows.some(r => r.value.toLowerCase() === value.toLowerCase())) {
      setError(`"${value}" is already on this list.`)
      return
    }

    const nextOrder = rows.reduce((max, r) => Math.max(max, r.sort_order ?? 0), 0) + 10
    const saved = await run('new', `Added "${value}".`, () =>
      supabase.from('settings_options').insert({ list_key: listKey, value, sort_order: nextOrder }))

    if (saved) setAdding('')
  }

  async function handleRename(row) {
    const value = draft.trim()

    if (!value) {
      setError('A value cannot be blank.')
      return
    }
    if (value === row.value) {
      setEditingId('')
      return
    }
    if (rows.some(r => r.id !== row.id && r.value.toLowerCase() === value.toLowerCase())) {
      setError(`"${value}" is already on this list.`)
      return
    }

    await run(row.id, `Renamed to "${value}". Records saved under the old name keep it.`, () =>
      supabase.from('settings_options').update({ value }).eq('id', row.id))
  }

  async function handleToggle(row) {
    await run(
      row.id,
      row.active ? `"${row.value}" is off and will not appear in new records.` : `"${row.value}" is back on.`,
      () => supabase.from('settings_options').update({ active: !row.active }).eq('id', row.id),
    )
  }

  async function handleRemove(row) {
    setError('')
    setNotice('')
    setBusyId(row.id)

    // ask the database how many live records point at this value before
    // offering to delete. the same count is enforced by a trigger.
    const { data: usage, error: usageError } = await attempt(
      () => supabase.rpc('settings_option_usage', { p_list_key: listKey, p_value: row.value }),
      'The usage count could not be checked.',
    )

    if (usageError) {
      setError(usageError)
      setBusyId('')
      return
    }

    if (Number(usage) > 0) {
      setError(`"${row.value}" is used by ${usage} existing ${Number(usage) === 1 ? 'record' : 'records'}, so it cannot be removed. Turn it off instead.`)
      setBusyId('')
      return
    }

    await run(row.id, `Removed "${row.value}".`, () =>
      supabase.from('settings_options').delete().eq('id', row.id))
  }

  const activeCount = rows.filter(r => r.active).length

  return (
    <section className="set-card">
      <header className="set-card-head">
        <div>
          <h2>{title}</h2>
          <p className="set-card-desc">{description}</p>
        </div>
        <span className="set-count">
          {activeCount} on{rows.length !== activeCount && `, ${rows.length - activeCount} off`}
        </span>
      </header>

      {rows.length === 0 && (
        <p className="set-empty">This list is empty, so the matching dropdown will have nothing to pick.</p>
      )}

      {rows.length > 0 && (
        <ul className="set-list">
          {rows.map(row => (
            <li key={row.id} className={row.active ? 'set-item' : 'set-item set-item-off'}>
              {editingId === row.id ? (
                <>
                  <input
                    className="set-input"
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    disabled={busyId === row.id}
                    aria-label={`Rename ${row.value}`}
                    autoFocus
                  />
                  <span className="set-item-actions">
                    <button type="button" className="tpl-link"
                      onClick={() => handleRename(row)} disabled={busyId === row.id}>
                      Save
                    </button>
                    <button type="button" className="tpl-link"
                      onClick={() => { setEditingId(''); setError('') }} disabled={busyId === row.id}>
                      Cancel
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span className="set-item-value">
                    {row.value}
                    {!row.active && <span className="inv-inactive">Off</span>}
                  </span>
                  <span className="set-item-actions">
                    <button type="button" className="tpl-link" disabled={busyId === row.id}
                      onClick={() => { setEditingId(row.id); setDraft(row.value); setError('') }}>
                      Rename
                    </button>
                    <button type="button" className="tpl-link" disabled={busyId === row.id}
                      onClick={() => handleToggle(row)}>
                      {row.active ? 'Turn off' : 'Turn on'}
                    </button>
                    <button type="button" className="tpl-danger" disabled={busyId === row.id}
                      onClick={() => handleRemove(row)}>
                      Remove
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="set-add" onSubmit={handleAdd} noValidate>
        <input
          className="set-input"
          value={adding}
          onChange={e => setAdding(e.target.value)}
          placeholder={`Add ${withArticle(singularise(lowerLabel(title)))}`}
          disabled={busyId === 'new'}
          aria-label={`Add to ${title}`}
        />
        <button type="submit" className="btn-cancel" disabled={busyId === 'new'}>
          {busyId === 'new' ? 'Adding...' : 'Add'}
        </button>
      </form>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="set-notice" role="status">{notice}</p>}
    </section>
  )
}
