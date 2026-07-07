import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SERVICE_CITIES, SYSTEM_TEMPLATES, FAUCET_FINISHES, PAYMENT_TYPES } from '../lib/constants'
import AppShell from '../components/AppShell'
import './NewJob.css'

const EMPTY_FORM = {
  customer_name: '',
  phone: '',
  address: '',
  city: '',
  water_source: 'city',
  system_template: 'Flagship Bundle',
  sale_price: '2999',
  payment_type: '',
  faucet_finish: '',
  status: 'sold',
  install_date: '',
  installer: '',
  payout_amount: '',
  invoice_number: '',
  notes: '',
}

export default function NewJob() {
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function handleChange(e) {
    const { name, value } = e.target
    if (name === 'system_template') {
      const tpl = SYSTEM_TEMPLATES.find(t => t.label === value)
      setForm(f => ({
        ...f,
        system_template: value,
        sale_price: tpl?.price != null ? String(tpl.price) : f.sale_price,
      }))
    } else {
      setForm(f => ({ ...f, [name]: value }))
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)

    const payload = {
      customer_name: form.customer_name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      city: form.city,
      water_source: form.water_source,
      system_template: form.system_template,
      sale_price: parseFloat(form.sale_price),
      payment_type: form.payment_type,
      faucet_finish: form.faucet_finish,
      status: form.status,
      install_date: form.install_date || null,
      installer: form.installer.trim() || null,
      payout_amount: form.payout_amount ? parseFloat(form.payout_amount) : null,
      invoice_number: form.invoice_number.trim(),
      notes: form.notes.trim() || null,
    }

    const { error: err } = await supabase.from('jobs').insert(payload)

    setSaving(false)

    if (err) {
      setError(err.message)
    } else {
      navigate('/jobs')
    }
  }

  return (
    <AppShell>
      <div className="newjob-page">
        <div className="newjob-header">
          <h1>New Job</h1>
        </div>

        <form className="newjob-form" onSubmit={handleSubmit} noValidate>

          <section className="form-section">
            <h2>Customer</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="customer_name">Customer Name</label>
                <input id="customer_name" name="customer_name" type="text" required
                  value={form.customer_name} onChange={handleChange} disabled={saving} />
              </div>
              <div className="field">
                <label htmlFor="phone">Phone</label>
                <input id="phone" name="phone" type="tel" required
                  value={form.phone} onChange={handleChange} disabled={saving} />
              </div>
              <div className="field field-full">
                <label htmlFor="address">Address</label>
                <input id="address" name="address" type="text" required
                  value={form.address} onChange={handleChange} disabled={saving} />
              </div>
              <div className="field">
                <label htmlFor="city">City</label>
                <select id="city" name="city" required
                  value={form.city} onChange={handleChange} disabled={saving}>
                  <option value="">Select city...</option>
                  {SERVICE_CITIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="water_source">Water Source</label>
                <select id="water_source" name="water_source" required
                  value={form.water_source} onChange={handleChange} disabled={saving}>
                  <option value="city">City</option>
                  <option value="well">Well</option>
                </select>
              </div>
            </div>
          </section>

          <section className="form-section">
            <h2>System</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="system_template">System Template</label>
                <select id="system_template" name="system_template" required
                  value={form.system_template} onChange={handleChange} disabled={saving}>
                  {SYSTEM_TEMPLATES.map(t => <option key={t.label} value={t.label}>{t.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sale_price">Sale Price ($)</label>
                <input id="sale_price" name="sale_price" type="number" min="0" step="0.01" required
                  value={form.sale_price} onChange={handleChange} disabled={saving} />
              </div>
              <div className="field">
                <label htmlFor="faucet_finish">Faucet Finish</label>
                <select id="faucet_finish" name="faucet_finish" required
                  value={form.faucet_finish} onChange={handleChange} disabled={saving}>
                  <option value="">Select finish...</option>
                  {FAUCET_FINISHES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="payment_type">Payment Type</label>
                <select id="payment_type" name="payment_type" required
                  value={form.payment_type} onChange={handleChange} disabled={saving}>
                  <option value="">Select type...</option>
                  {PAYMENT_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
          </section>

          <section className="form-section">
            <h2>Job Details</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="status">Status</label>
                <select id="status" name="status" required
                  value={form.status} onChange={handleChange} disabled={saving}>
                  <option value="sold">Sold</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="installed">Installed</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="invoice_number">Invoice Number</label>
                <input id="invoice_number" name="invoice_number" type="text" required
                  value={form.invoice_number} onChange={handleChange} disabled={saving} />
              </div>
              <div className="field">
                <label htmlFor="install_date">Install Date <span className="optional">(optional)</span></label>
                <input id="install_date" name="install_date" type="date"
                  value={form.install_date} onChange={handleChange} disabled={saving} />
              </div>
              <div className="field">
                <label htmlFor="installer">Installer <span className="optional">(optional)</span></label>
                <input id="installer" name="installer" type="text"
                  value={form.installer} onChange={handleChange} disabled={saving} />
              </div>
              <div className="field">
                <label htmlFor="payout_amount">Payout Amount ($) <span className="optional">(optional)</span></label>
                <input id="payout_amount" name="payout_amount" type="number" min="0" step="0.01"
                  value={form.payout_amount} onChange={handleChange} disabled={saving} />
              </div>
              <div className="field field-full">
                <label htmlFor="notes">Notes <span className="optional">(optional)</span></label>
                <textarea id="notes" name="notes" rows="3"
                  value={form.notes} onChange={handleChange} disabled={saving} />
              </div>
            </div>
          </section>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="form-actions">
            <button type="button" className="btn-cancel"
              onClick={() => navigate('/jobs')} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Job'}
            </button>
          </div>

        </form>
      </div>
    </AppShell>
  )
}
