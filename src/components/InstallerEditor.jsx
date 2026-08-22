import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'

const DEFAULT_COLOR = '#2C819B'

// The crew roster. Same shape as the other pick lists, with two differences
// that earn their place: a colour, because the calendar stripes cards by
// installer, and a delete that is refused by a foreign key rather than by a
// usage count, since a job points at a person by id.
export default function InstallerEditor({ installers, onChanged }) {
  const [draft, setDraft] = useState({ name: '', phone: '', email: '', color: DEFAULT_COLOR })
  const [editingId, setEditingId] = useState('')
  const [edit, setEdit] = useState({ name: '', phone: '', email: '', color: DEFAULT_COLOR })
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function run(id, message, work) {
    setError('')
    setNotice('')
    setBusyId(id)

    const { error: err } = await attempt(work, 'That roster change could not be saved.')

    if (err) {
      setError(err)
      setBusyId('')
      return false
    }

    setEditingId('')
    setBusyId('')
    setNotice(message)
    onChanged()
    return true
  }

  function duplicate(name, exceptId) {
    return installers.some(i =>
      i.id !== exceptId && i.name.trim().toLowerCase() === name.toLowerCase())
  }

  async function handleAdd(e) {
    e.preventDefault()
    const name = draft.name.trim()

    if (!name) {
      setError('Type a name first.')
      return
    }
    if (duplicate(name, '')) {
      setError(`${name} is already on the roster.`)
      return
    }

    const nextOrder = installers.reduce((max, i) => Math.max(max, i.sort_order ?? 0), 0) + 10

    const saved = await run('new', `Added ${name}.`, () =>
      supabase.from('installers').insert({
        name,
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        color: draft.color,
        sort_order: nextOrder,
      }))

    if (saved) setDraft({ name: '', phone: '', email: '', color: DEFAULT_COLOR })
  }

  async function handleSaveEdit(row) {
    const name = edit.name.trim()

    if (!name) {
      setError('A name cannot be blank.')
      return
    }
    if (duplicate(name, row.id)) {
      setError(`${name} is already on the roster.`)
      return
    }

    await run(row.id, `Saved ${name}. Every job assigned to them now reads the new name.`, () =>
      supabase.from('installers').update({
        name,
        phone: edit.phone.trim() || null,
        email: edit.email.trim() || null,
        color: edit.color,
      }).eq('id', row.id))
  }

  async function handleToggle(row) {
    await run(
      row.id,
      row.active
        ? `${row.name} is off and will not appear when assigning new work. Their finished jobs keep their name.`
        : `${row.name} is back on and can be assigned again.`,
      () => supabase.from('installers').update({ active: !row.active }).eq('id', row.id),
    )
  }

  async function handleRemove(row) {
    await run(row.id, `Removed ${row.name}.`, () =>
      supabase.from('installers').delete().eq('id', row.id))
  }

  function startEdit(row) {
    setEditingId(row.id)
    setEdit({ name: row.name, phone: row.phone || '', email: row.email || '', color: row.color || DEFAULT_COLOR })
    setError('')
  }

  const activeCount = installers.filter(i => i.active).length

  return (
    <section className="set-card">
      <header className="set-card-head">
        <div>
          <h2>Installers</h2>
          <p className="set-card-desc">
            The crew a job can be assigned to, as lead or as helper. The colour is the
            stripe their jobs carry on the schedule.
          </p>
        </div>
        <span className="set-count">
          {activeCount} on{installers.length !== activeCount && `, ${installers.length - activeCount} off`}
        </span>
      </header>

      {installers.length === 0 && (
        <p className="set-empty">
          The roster is empty, so jobs cannot be assigned to anyone yet.
        </p>
      )}

      {installers.length > 0 && (
        <ul className="set-list">
          {installers.map(row => (
            <li key={row.id} className={row.active ? 'set-item' : 'set-item set-item-off'}>
              {editingId === row.id ? (
                <>
                  <span className="set-crew-fields">
                    <input className="set-input" value={edit.name} autoFocus
                      aria-label={`Rename ${row.name}`} disabled={busyId === row.id}
                      onChange={e => setEdit(d => ({ ...d, name: e.target.value }))} />
                    <input className="set-input" value={edit.email} placeholder="Email"
                      type="email" aria-label="Installer email" disabled={busyId === row.id}
                      onChange={e => setEdit(d => ({ ...d, email: e.target.value }))} />
                    <input className="set-input" value={edit.phone} placeholder="Phone"
                      aria-label={`Phone for ${row.name}`} disabled={busyId === row.id}
                      onChange={e => setEdit(d => ({ ...d, phone: e.target.value }))} />
                    <input type="color" value={edit.color} className="set-color"
                      aria-label={`Colour for ${row.name}`} disabled={busyId === row.id}
                      onChange={e => setEdit(d => ({ ...d, color: e.target.value }))} />
                  </span>
                  <span className="set-item-actions">
                    <button type="button" className="tpl-link" disabled={busyId === row.id}
                      onClick={() => handleSaveEdit(row)}>Save</button>
                    <button type="button" className="tpl-link" disabled={busyId === row.id}
                      onClick={() => { setEditingId(''); setError('') }}>Cancel</button>
                  </span>
                </>
              ) : (
                <>
                  <span className="set-item-value">
                    <span className="set-swatch" style={{ background: row.color }} aria-hidden="true" />
                    {row.name}
                    {row.email
                      ? <span className="set-crew-phone">{row.email}</span>
                      : <span className="cell-unset">no email, cannot receive work orders</span>}
                    {row.phone && <span className="set-crew-phone">{row.phone}</span>}
                    {!row.active && <span className="inv-inactive">Off</span>}
                  </span>
                  <span className="set-item-actions">
                    <button type="button" className="tpl-link" disabled={busyId === row.id}
                      onClick={() => startEdit(row)}>Edit</button>
                    <button type="button" className="tpl-link" disabled={busyId === row.id}
                      onClick={() => handleToggle(row)}>
                      {row.active ? 'Turn off' : 'Turn on'}
                    </button>
                    <button type="button" className="tpl-danger" disabled={busyId === row.id}
                      onClick={() => handleRemove(row)}>Remove</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="set-add set-add-crew" onSubmit={handleAdd} noValidate>
        <input className="set-input" value={draft.name} placeholder="Add an installer"
          aria-label="New installer name" disabled={busyId === 'new'}
          onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
        <input className="set-input" value={draft.email} placeholder="Email, for work orders"
          type="email" aria-label="New installer email" disabled={busyId === 'new'}
          onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} />
        <input className="set-input" value={draft.phone} placeholder="Phone (optional)"
          aria-label="New installer phone" disabled={busyId === 'new'}
          onChange={e => setDraft(d => ({ ...d, phone: e.target.value }))} />
        <input type="color" value={draft.color} className="set-color"
          aria-label="New installer colour" disabled={busyId === 'new'}
          onChange={e => setDraft(d => ({ ...d, color: e.target.value }))} />
        <button type="submit" className="btn-cancel" disabled={busyId === 'new'}>
          {busyId === 'new' ? 'Adding...' : 'Add'}
        </button>
      </form>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="set-notice" role="status">{notice}</p>}
    </section>
  )
}
