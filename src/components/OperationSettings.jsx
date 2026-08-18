import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { defaultInstallerPay } from '../lib/settings'
import { formatCurrency, formatDateTime } from '../lib/inventory'

const SAMPLE_PRICE = 2999

export default function OperationSettings({ settings, onChanged }) {
  const [form, setForm] = useState({
    installer_pay_mode: settings.installerPayMode,
    installer_pay_rate: String(settings.installerPayRate ?? 0),
    default_location: settings.defaultLocation || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const rate = Number(form.installer_pay_rate)
  const preview = defaultInstallerPay(form.installer_pay_mode, rate, SAMPLE_PRICE)

  const updatedAt = settings.scalarRows
    .map(r => r.updated_at)
    .sort()
    .pop()

  function handleChange(e) {
    const { name, value } = e.target
    setNotice('')
    setForm(f => ({ ...f, [name]: value }))
  }

  function validate() {
    if (!Number.isFinite(rate) || rate < 0) return 'The pay rate must be zero or greater.'
    if (form.installer_pay_mode === 'percent' && rate > 100) {
      return 'A percentage rate cannot be over 100.'
    }
    if (!form.default_location.trim()) return 'The default location cannot be blank.'
    return ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }

    setError('')
    setNotice('')
    setSaving(true)

    const rows = [
      { key: 'installer_pay_mode', text_value: form.installer_pay_mode, numeric_value: null },
      { key: 'installer_pay_rate', numeric_value: rate, text_value: null },
      { key: 'default_location', text_value: form.default_location.trim(), numeric_value: null },
    ].map(r => ({ ...r, updated_at: new Date().toISOString() }))

    const { error: err } = await attempt(
      () => supabase.from('app_settings').upsert(rows, { onConflict: 'key' }),
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
            Defaults the rest of the app reads. Installer pay prefills a new job and can
            still be typed over. Changing it never rewrites a job that is already saved.
          </p>
        </div>
        {updatedAt && <span className="set-count">Updated {formatDateTime(updatedAt)}</span>}
      </header>

      <form className="modal-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="installer_pay_mode">Installer Pay Rate</label>
            <select id="installer_pay_mode" name="installer_pay_mode"
              value={form.installer_pay_mode} onChange={handleChange} disabled={saving}>
              <option value="flat">Flat amount per job</option>
              <option value="percent">Percent of sale price</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="installer_pay_rate">
              {form.installer_pay_mode === 'percent' ? 'Rate (%)' : 'Amount ($)'}
            </label>
            <input id="installer_pay_rate" name="installer_pay_rate" type="number"
              min="0" step="0.01" value={form.installer_pay_rate}
              onChange={handleChange} disabled={saving} />
            <span className="field-hint">Zero means no default, type it on each job.</span>
          </div>

          <div className="field field-full">
            <label htmlFor="default_location">Default Stock Location</label>
            <input id="default_location" name="default_location" type="text"
              value={form.default_location} onChange={handleChange} disabled={saving} />
            <span className="field-hint">Stamped on every new inventory transaction.</span>
          </div>
        </div>

        <div className={preview == null ? 'txn-effect txn-effect-in' : 'txn-effect txn-effect-out'}>
          <span className="txn-effect-verb">Preview</span>
          <span className="txn-effect-detail">
            {preview == null
              ? 'No default pay. New jobs start with the installer pay field empty.'
              : `A ${formatCurrency(SAMPLE_PRICE)} job would prefill ${formatCurrency(preview)} of installer pay.`}
          </span>
        </div>

        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="set-notice" role="status">{notice}</p>}

        <div className="modal-actions">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Operations Settings'}
          </button>
        </div>
      </form>
    </section>
  )
}
