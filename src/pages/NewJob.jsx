import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { FAUCET_FINISHES, PAYMENT_TYPES } from '../lib/constants'
import { attempt } from '../lib/errors'
import { useSystemTemplates } from '../lib/useSystemTemplates'
import AppShell from '../components/AppShell'
import CustomerFields from '../components/CustomerFields'
import JobDetailFields from '../components/JobDetailFields'
import JobPartsPreview from '../components/JobPartsPreview'
import './NewJob.css'

const EMPTY_FORM = {
  customer_name: '',
  phone: '',
  address: '',
  city: '',
  water_source: 'city',
  system_template: '',
  sale_price: '',
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

  const {
    templates,
    loading: loadingTemplates,
    error: templateError,
    reload: reloadTemplates,
  } = useSystemTemplates({ activeOnly: true })

  // preselect the first template once they arrive, matching the old default
  useEffect(() => {
    if (templates.length === 0) return
    setForm(f => {
      if (f.system_template) return f
      const first = templates[0]
      return {
        ...f,
        system_template: first.label,
        sale_price: first.default_price == null ? '' : String(first.default_price),
      }
    })
  }, [templates])

  const selectedTemplate = useMemo(
    () => templates.find(t => t.label === form.system_template) || null,
    [templates, form.system_template],
  )

  function handleChange(e) {
    const { name, value } = e.target
    if (name === 'system_template') {
      const tpl = templates.find(t => t.label === value)
      setForm(f => ({
        ...f,
        system_template: value,
        sale_price: tpl?.default_price != null ? String(tpl.default_price) : f.sale_price,
      }))
      return
    }
    setForm(f => ({ ...f, [name]: value }))
  }

  function validate() {
    if (!form.customer_name.trim()) return 'Customer name is required.'
    if (!form.phone.trim()) return 'Phone is required.'
    if (!form.address.trim()) return 'Address is required.'
    if (!form.city) return 'Pick a city.'
    if (!form.system_template) return 'Pick a system template.'
    if (!form.payment_type) return 'Pick a payment type.'
    if (!form.faucet_finish) return 'Pick a faucet finish.'
    if (!form.invoice_number.trim()) return 'Invoice number is required.'

    const price = Number(form.sale_price)
    if (!Number.isFinite(price) || price < 0) return 'Sale price must be zero or greater.'

    if (form.payout_amount !== '') {
      const payout = Number(form.payout_amount)
      if (!Number.isFinite(payout) || payout < 0) return 'Payout amount must be zero or greater.'
    }

    if (form.status === 'installed' && !selectedTemplate) {
      return 'That template is no longer available, so parts cannot be deducted. Reload and pick another.'
    }

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
    setSaving(true)

    // A job never enters the installed state by plain insert. It is created in
    // its pre install state and mark_job_installed does the deduction, which is
    // the only path that can consume inventory. A database trigger enforces it.
    const wantsInstall = form.status === 'installed'

    const payload = {
      customer_name: form.customer_name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      city: form.city,
      water_source: form.water_source,
      system_template: form.system_template,
      template_id: selectedTemplate?.id || null,
      sale_price: Number(form.sale_price),
      payment_type: form.payment_type,
      faucet_finish: form.faucet_finish,
      status: wantsInstall ? 'scheduled' : form.status,
      install_date: form.install_date || null,
      installer: form.installer.trim() || null,
      payout_amount: form.payout_amount === '' ? null : Number(form.payout_amount),
      invoice_number: form.invoice_number.trim(),
      notes: form.notes.trim() || null,
    }

    const { data, error: insertError } = await attempt(
      () => supabase.from('jobs').insert(payload).select('id').single(),
      'The job could not be saved.',
    )

    if (insertError) {
      setError(insertError)
      setSaving(false)
      return
    }

    if (!wantsInstall) {
      navigate('/jobs')
      return
    }

    const { error: installError } = await attempt(
      () => supabase.rpc('mark_job_installed', {
        p_job_id: data.id,
        p_install_date: form.install_date || null,
        p_installer: form.installer.trim() || null,
        p_payout: form.payout_amount === '' ? null : Number(form.payout_amount),
      }),
      'The job was saved but its parts could not be deducted.',
    )

    setSaving(false)

    if (installError) {
      setError(`${installError} The job was saved as Scheduled. Fix the problem, then install it from the jobs list.`)
      return
    }

    navigate('/jobs')
  }

  return (
    <AppShell>
      <div className="newjob-page">
        <div className="newjob-header">
          <h1>New Job</h1>
        </div>

        <form className="newjob-form" onSubmit={handleSubmit} noValidate>

          <CustomerFields form={form} onChange={handleChange} disabled={saving} />

          <section className="form-section">
            <h2>System</h2>

            {templateError && (
              <div className="inv-error-box" role="alert">
                <p className="inv-error-detail">{templateError}</p>
                <button type="button" className="btn-cancel" onClick={reloadTemplates}>Try again</button>
              </div>
            )}

            {!templateError && !loadingTemplates && templates.length === 0 && (
              <p className="form-warning" role="status">
                No active system templates exist. Create one on the Templates page first.
              </p>
            )}

            <div className="form-grid">
              <div className="field">
                <label htmlFor="system_template">System Template</label>
                <select id="system_template" name="system_template" required
                  value={form.system_template} onChange={handleChange}
                  disabled={saving || loadingTemplates || templates.length === 0}>
                  <option value="">
                    {loadingTemplates ? 'Loading templates...' : 'Select system...'}
                  </option>
                  {templates.map(t => <option key={t.id} value={t.label}>{t.label}</option>)}
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
                <span className="field-hint">Decides which faucet the template consumes.</span>
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

            <JobPartsPreview
              templateId={selectedTemplate?.id || ''}
              templateLabel={form.system_template}
              faucetFinish={form.faucet_finish}
            />
          </section>

          <JobDetailFields form={form} onChange={handleChange} disabled={saving} />

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="form-actions">
            <button type="button" className="btn-cancel"
              onClick={() => navigate('/jobs')} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary"
              disabled={saving || loadingTemplates || templates.length === 0}>
              {saving ? 'Saving...' : 'Save Job'}
            </button>
          </div>

        </form>
      </div>
    </AppShell>
  )
}
