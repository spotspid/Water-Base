import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { formatDateTime } from '../lib/inventory'

// Scalars the rest of the app reads.
//
// Installer pay used to be configured here as a house rate that prefilled new
// jobs. It is gone. The amount varies by installer and by job, so the rate was
// wrong more often than right and had to be typed over anyway. The field on
// the job is now the only place it is set, and job_margin subtracts it there.
export default function OperationSettings({ settings, onChanged }) {
  const [form, setForm] = useState({
    default_location: settings.defaultLocation || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const updatedAt = settings.scalarRows
    .map(r => r.updated_at)
    .sort()
    .pop()

  function handleChange(e) {
    const { name, value } = e.target
    setNotice('')
    setForm(f => ({ ...f, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    if (!form.default_location.trim()) {
      setError('The default location cannot be blank.')
      return
    }

    setError('')
    setNotice('')
    setSaving(true)

    const { error: err } = await attempt(
      () => supabase.from('app_settings').upsert(
        [{
          key: 'default_location',
          text_value: form.default_location.trim(),
          numeric_value: null,
          updated_at: new Date().toISOString(),
        }],
        { onConflict: 'key' },
      ),
      'These settings could not be saved.',
    )

    setSaving(false)

    if (err) {
      setError(err)
      return
    }

    setNotice('Saved.')
    onChanged()
  }

  return (
    <section className="set-card">
      <header className="set-card-head">
        <div>
          <h2>Operations</h2>
          <p className="set-card-desc">
            Defaults the rest of the app reads. Changing one never rewrites a record that
            is already saved.
          </p>
        </div>
        {updatedAt && <span className="set-count">Updated {formatDateTime(updatedAt)}</span>}
      </header>

      <form className="modal-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="field field-full">
            <label htmlFor="default_location">Default stock location</label>
            <input id="default_location" name="default_location" type="text"
              value={form.default_location} onChange={handleChange} disabled={saving} />
            <span className="field-hint">Stamped on every new inventory transaction.</span>
          </div>
        </div>

        <div className="txn-effect txn-effect-in">
          <span className="txn-effect-verb">Installer pay</span>
          <span className="txn-effect-detail">
            Entered per job, with no default. It varies by installer and by job, so there
            is no house rate to configure here.
          </span>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="set-notice" role="status">{notice}</p>}

        <div className="modal-actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save operations settings'}
          </button>
        </div>
      </form>
    </section>
  )
}
