import { useEffect, useMemo, useRef, useState } from 'react'
import { useSystemTemplates } from '../lib/useSystemTemplates'
import {
  formFromJob, isDirty, validateEdit, saveJobDetails, LOCKED_REASON,
} from '../lib/jobEdit'
import CustomerFields from './CustomerFields'
import JobSystemFields from './JobSystemFields'
import JobEditDetailFields from './JobEditDetailFields'
import Modal from './Modal'

// Everything the new job form captured, editable on a job that already exists.
//
// The same two field components the new job form uses, rather than a second
// set that would drift. The only thing this adds is the lock: an installed
// job's build sheet, picks and invoice number are read only, said once at the
// top and enforced again by update_job_details, which is the one that matters.
//
// The schedule, the crew and the pay are not here. They are edited in their
// own panels behind their own functions, and this form would be a second
// writer for them.
export default function JobEditModal({ job, hasOwnParts, focusField = '', onClose, onSaved }) {
  const [form, setForm] = useState(() => formFromJob(job))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const formRef = useRef(null)

  // An alert that named a field opens this form on that field: scrolled to,
  // focused, and outlined so it is obvious which of a dozen boxes was meant.
  //
  // Done by name attribute rather than by id, because the same field
  // components are shared with the new job form and only the names are stable
  // across both. A field that is not on this form, or a browser that will not
  // focus it, simply leaves the form as it was: this is a convenience, and it
  // must never be able to break the form it is trying to help with.
  useEffect(() => {
    if (!focusField || !formRef.current) return

    let cancelled = false

    // after paint, so the field exists and the modal has finished opening
    const timer = window.setTimeout(() => {
      if (cancelled || !formRef.current) return

      try {
        const el = formRef.current.querySelector(`[name="${CSS.escape(focusField)}"]`)
        if (!el) return

        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        el.focus({ preventScroll: true })
        el.classList.add('field-called-out')
      } catch {
        // an unsupported selector or a browser that refuses focus is not a
        // reason to fail the edit form
      }
    }, 0)

    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [focusField])

  const installed = job.parts_deducted_at != null

  // The job's current sheet stays selectable even if it has since been
  // deactivated, so opening the form does not silently propose a change.
  const {
    templates, loading: loadingTemplates, error: templateError, reload: reloadTemplates,
  } = useSystemTemplates({ activeOnly: true, keepIds: [job.template_id] })

  const selectedTemplate = useMemo(
    () => templates.find(t => t.label === form.system_template) || null,
    [templates, form.system_template],
  )

  const dirty = isDirty(form, job)

  function handleChange(e) {
    const { name, value } = e.target

    // Unlike the new job form, picking a sheet here does not rewrite the sale
    // price. The price on a saved job is what was agreed with the customer,
    // and a default overwriting it would be a quiet discount or a quiet raise.
    setForm(f => ({ ...f, [name]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()

    const problem = validateEdit(form, { job, hasOwnParts })
    if (problem) {
      setError(problem)
      return
    }

    // The sheet is sent by id. A label that matches no sheet would otherwise
    // reach the database as a job naming something it is not linked to.
    if (form.system_template && !selectedTemplate) {
      setError('That build sheet is no longer available. Reload and pick another.')
      return
    }

    setError('')
    setSaving(true)

    const { error: saveError, message } = await saveJobDetails(
      job, form, selectedTemplate?.id || null,
    )

    setSaving(false)

    if (saveError) {
      setError(saveError)
      return
    }

    onSaved(message)
  }

  function handleClose() {
    if (dirty && !saving
      && !window.confirm('Close without saving? The changes on this form will be lost.')) {
      return
    }

    onClose()
  }

  return (
    <Modal title={`Edit ${job.customer_name}`} onClose={handleClose} wide>
      {installed && (
        <p className="form-warning" role="status">{LOCKED_REASON}</p>
      )}

      {hasOwnParts && (
        <p className="inv-ledger-note">
          This job lists its own parts, so those are what it claims and what it will
          deduct. Its build sheet is recorded but not used. Clear the list to put the
          sheet back in charge.
        </p>
      )}

      <form className="job-edit-form" ref={formRef} onSubmit={handleSubmit} noValidate>

        <CustomerFields form={form} onChange={handleChange} disabled={saving} />

        <JobSystemFields
          form={form}
          onChange={handleChange}
          disabled={saving}
          lockedPicks={installed}
          hidePreview
          templateOptional={hasOwnParts}
          templates={templates}
          loadingTemplates={loadingTemplates}
          templateError={templateError}
          onReloadTemplates={reloadTemplates}
          selectedTemplate={selectedTemplate}
        />

        <JobEditDetailFields
          form={form}
          onChange={handleChange}
          disabled={saving}
          lockInvoice={installed}
        />

        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn-cancel" onClick={handleClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !dirty}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>

      </form>
    </Modal>
  )
}
