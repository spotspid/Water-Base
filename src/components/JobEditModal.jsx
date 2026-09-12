import { useMemo, useState } from 'react'
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
export default function JobEditModal({ job, hasOwnParts, onClose, onSaved }) {
  const [form, setForm] = useState(() => formFromJob(job))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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

    const problem = validateEdit(form, { hasOwnParts })
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

      <form className="job-edit-form" onSubmit={handleSubmit} noValidate>

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
