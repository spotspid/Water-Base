import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { attempt } from '../lib/errors'
import { useSystemTemplates } from '../lib/useSystemTemplates'
import { suggestedDeposit, withPrice } from '../lib/depositState'
import { sendQuote } from '../lib/agreements'
import { validateNewJob } from '../lib/newJobForm'
import { applyRoPick } from '../lib/roPicks'
import {
  SITE_KEYS, SIZING_KEYS, checklistFromForm, emptyChecklistForm, isEmptyChecklist,
  validateChecklist,
} from '../lib/salesChecklist'
import AppShell from '../components/AppShell'
import CustomerFields from '../components/CustomerFields'
import InstallRateCard from '../components/InstallRateCard'
import JobDetailFields from '../components/JobDetailFields'
import JobSystemFields from '../components/JobSystemFields'
import NewJobActions from '../components/NewJobActions'
import SalesChecklistFields from '../components/SalesChecklistFields'
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
  deposit_amount: '',
  payment_type: '',
  faucet_finish: '',
  ro_type: '',
  valve_type: '',
  // Quoted by default. Sold stays in the list for a sale closed on the phone.
  status: 'quoted',
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
  // '' when idle, otherwise which button is running, so only that one says
  // Saving and the other is simply disabled.
  const [savingAs, setSavingAs] = useState('')
  const saving = savingAs !== ''
  const [error, setError] = useState('')

  // Once somebody types a deposit it stops following the price. The rule is
  // withPrice in depositState, where check:deposits can reach it.
  const [depositTouched, setDepositTouched] = useState(false)

  // Kept apart from the job form: its values are an object stored in one
  // column, and its blanks are allowed where the form's are not.
  const [checklist, setChecklist] = useState(emptyChecklistForm)
  const checklistShown = form.status === 'quoted'

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
      const price = first.default_price == null ? '' : String(first.default_price)
      // untouched on first load by definition, so the deposit follows
      return {
        ...f,
        system_template: first.label,
        sale_price: price,
        deposit_amount: f.deposit_amount === '' ? suggestedDeposit(price) : f.deposit_amount,
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
        ...withPrice(f, tpl?.default_price != null ? String(tpl.default_price) : f.sale_price, depositTouched),
        system_template: value,
      }))
      return
    }
    if (name === 'sale_price') {
      setForm(f => withPrice(f, value, depositTouched))
      return
    }
    if (name === 'deposit_amount') setDepositTouched(true)
    // Picking No RO sets the faucet to N/A in the same step; see roPicks.js.
    setForm(f => applyRoPick(f, name, value))
  }

  // Enter in a field submits the form, and that is Save quote. A keystroke
  // must never be the thing that emails a customer.
  function handleSubmit(e) {
    e.preventDefault()
    save(false)
  }

  // send is true only for Save and send quote. Both buttons save through the
  // same insert; send then runs sendQuote on the job that was just written.
  async function save(send) {
    if (saving) return
    const problem = validateNewJob(form, { sending: send, selectedTemplate })
      || (checklistShown ? validateChecklist(checklist) : '')
    if (problem) {
      setError(problem)
      return
    }

    setError('')
    setSavingAs(send ? 'send' : 'save')

    // A job never enters the installed state by plain insert. It is created in
    // its pre install state and mark_job_installed does the deduction, which is
    // the only path that can consume inventory. A database trigger enforces it.
    const wantsInstall = form.status === 'installed'

    const payload = {
      customer_name: form.customer_name.trim(),
      phone: form.phone.trim(),
      customer_email: form.customer_email.trim() || null,
      address: form.address.trim(),
      city: form.city.trim(),
      water_source: form.water_source,
      system_template: form.system_template,
      template_id: selectedTemplate?.id || null,
      sale_price: Number(form.sale_price),
      deposit_amount: Number(form.deposit_amount),
      payment_type: form.payment_type || null,
      faucet_finish: form.faucet_finish || null,
      ro_type: form.ro_type || null,
      // Optional here. An RO only job has no control valve, and the parts
      // preview flags an unresolved valve line on a sheet that needs one.
      valve_type: form.valve_type || null,
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

    // Left out when nothing was answered, which stores the column default of
    // an empty object and so means the same thing.
    const storedChecklist = checklistShown ? checklistFromForm(checklist) : {}
    if (!isEmptyChecklist(storedChecklist)) payload.sales_checklist = storedChecklist

    const { data, error: insertError } = await attempt(
      () => supabase.from('jobs').insert(payload).select('id').single(),
      'The job could not be saved.',
    )

    if (insertError) {
      setError(insertError)
      setSavingAs('')
      return
    }

    if (send) {
      const { error: sendError } = await sendQuote(data.id)
      setSavingAs('')
      if (sendError) {
        setError(`The quote was saved but not sent. ${sendError} Open it from the jobs list to send it.`)
        return
      }
      navigate(`/quotes?job=${data.id}`)
      return
    }

    if (!wantsInstall) {
      // A quote belongs on the quotes page; anything already sold goes to the
      // jobs list, which is where it will be from now on.
      navigate(payload.status === 'quoted' ? '/quotes' : '/jobs')
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

    setSavingAs('')

    if (installError) {
      setError(`${installError} The job was saved as Scheduled. Fix the problem, then install it from the jobs list.`)
      return
    }

    navigate('/jobs')
  }

  const canSend = form.status === 'quoted'

  // no default. it varies by installer and by job, so it is typed every time.
  const payHint = 'Flat amount for this job. Subtracted from margin.'

  return (
    <AppShell>
      <div className="newjob-page">

        <form className="newjob-form" onSubmit={handleSubmit} noValidate>

          <CustomerFields form={form} onChange={handleChange} disabled={saving} />

          {/* Both halves of the checklist come before the system: sizing decides
              which system to quote, and site is asked in the same walk round the
              house, before anyone sits down to pick equipment. */}
          {checklistShown && (
            <SalesChecklistFields
              title="Sales checklist: sizing"
              keys={SIZING_KEYS}
              showJobFields={false}
              value={checklist}
              onChange={setChecklist}
              job={form}
              disabled={saving}
            />
          )}

          {checklistShown && (
            <SalesChecklistFields
              title="Sales checklist: site"
              keys={SITE_KEYS}
              value={checklist}
              onChange={setChecklist}
              job={form}
              disabled={saving}
              jobFieldsNote="Faucet finish, RO type and payment type are chosen in the System section below."
            />
          )}

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

          <InstallRateCard />

          {error && <p className="form-error" role="alert">{error}</p>}

          <NewJobActions
            savingAs={savingAs}
            canSend={canSend}
            unavailable={loadingTemplates || templates.length === 0}
            onCancel={() => navigate('/jobs')}
            onSend={() => save(true)}
          />

        </form>
      </div>
    </AppShell>
  )
}
