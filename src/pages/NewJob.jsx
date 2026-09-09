import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { useSystemTemplates } from '../lib/useSystemTemplates'
import AppShell from '../components/AppShell'
import CustomerFields from '../components/CustomerFields'
import JobDetailFields from '../components/JobDetailFields'
import JobSystemFields from '../components/JobSystemFields'
import './NewJob.css'

const EMPTY_FORM = {
  customer_name: '',
  phone: '',
  customer_email: '',
  address: '',
  city: '',
  water_source: 'city',
  system_template: '',
  sale_price: '',
  payment_type: '',
  faucet_finish: '',
  ro_type: '',
  status: 'sold',
  scheduled_date: '',
  time_window: '',
  installer_id: '',
  helper_id: '',
  install_date: '',
  payout_amount: '',
  invoice_number: '',
  site_conditions: '',
  notes: '',
}

export default function NewJob() {
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // the pick lists moved into JobSystemFields and JobDetailFields, which read
  // them from the same context, so this page reads no settings of its own.

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

    // optional, but a typo here means the agreement silently never arrives
    const email = form.customer_email.trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return 'That email address does not look right.'
    }

    if (!form.city) return 'Pick a city.'
    if (!form.system_template) return 'Pick a system template.'
    if (!form.payment_type) return 'Pick a payment type.'
    if (!form.faucet_finish) return 'Pick a faucet finish.'
    if (!form.ro_type) return 'Pick an RO type.'
    if (!form.invoice_number.trim()) return 'Invoice number is required.'

    const price = Number(form.sale_price)
    if (!Number.isFinite(price) || price < 0) return 'Sale price must be zero or greater.'

    if (form.payout_amount !== '') {
      const payout = Number(form.payout_amount)
      if (!Number.isFinite(payout) || payout < 0) return 'Payout amount must be zero or greater.'
    }

    if (form.installer_id && form.helper_id && form.installer_id === form.helper_id) {
      return 'The installer and the helper cannot be the same person.'
    }

    if (!form.scheduled_date && form.time_window) {
      return 'Pick a scheduled date before picking a time window, or clear the window.'
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
      customer_email: form.customer_email.trim() || null,
      address: form.address.trim(),
      city: form.city,
      water_source: form.water_source,
      system_template: form.system_template,
      template_id: selectedTemplate?.id || null,
      sale_price: Number(form.sale_price),
      payment_type: form.payment_type,
      faucet_finish: form.faucet_finish,
      ro_type: form.ro_type || null,
      status: wantsInstall ? 'scheduled' : form.status,
      scheduled_date: form.scheduled_date || null,
      time_window: form.scheduled_date ? (form.time_window || null) : null,
      installer_id: form.installer_id || null,
      helper_id: form.helper_id || null,
      install_date: form.install_date || null,
      payout_amount: form.payout_amount === '' ? null : Number(form.payout_amount),
      invoice_number: form.invoice_number.trim(),
      site_conditions: form.site_conditions.trim() || null,
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
        p_install_date: form.install_date || form.scheduled_date || null,
        p_installer: null,
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

  // no default. it varies by installer and by job, so it is typed every time.
  const payHint = 'Flat amount for this job. Subtracted from margin.'

  return (
    <AppShell>
      <div className="newjob-page">
        <div className="newjob-header">
          <h1>New Job</h1>
        </div>

        <form className="newjob-form" onSubmit={handleSubmit} noValidate>

          <CustomerFields form={form} onChange={handleChange} disabled={saving} />

          <JobSystemFields
            form={form}
            onChange={handleChange}
            disabled={saving}
            templates={templates}
            loadingTemplates={loadingTemplates}
            templateError={templateError}
            onReloadTemplates={reloadTemplates}
            selectedTemplate={selectedTemplate}
          />


          <JobDetailFields
            form={form}
            onChange={handleChange}
            disabled={saving}
            payHint={payHint}
          />

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="form-actions">
            <button type="button" className="btn-cancel"
              onClick={() => navigate('/jobs')} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary"
              disabled={saving || loadingTemplates || templates.length === 0}>
              {saving ? 'Saving...' : 'Save job'}
            </button>
          </div>

        </form>
      </div>
    </AppShell>
  )
}
