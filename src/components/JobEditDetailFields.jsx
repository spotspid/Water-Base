// The rest of what the new job form captured, minus everything the schedule
// owns.
//
// JobDetailFields, the version on the new job form, also holds the status, the
// date, the window, the crew, the install date and the pay. On a saved job
// those are written by schedule_job, mark_job_installed and the crew panel,
// each of which knows something this form does not: that a date claims parts,
// that an install deducts them, that a roster change has to keep an installed
// job's record intact. So this is the remainder rather than a copy with fields
// switched off, because a disabled input still looks like it might work.
export default function JobEditDetailFields({ form, onChange, disabled, lockInvoice }) {
  return (
    <section className="form-section">
      <h2>Job details</h2>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="edit_invoice_number">Invoice number</label>
          <input id="edit_invoice_number" name="invoice_number" type="text" required
            value={form.invoice_number} onChange={onChange}
            disabled={disabled || lockInvoice} />
          {lockInvoice && (
            <span className="field-hint">
              Stamped on every ledger row this job deducted, so it is fixed now.
            </span>
          )}
        </div>

        <div className="field field-full">
          <label htmlFor="edit_site_conditions">
            Site conditions <span className="optional">(optional)</span>
          </label>
          <textarea id="edit_site_conditions" name="site_conditions" rows="3"
            value={form.site_conditions} onChange={onChange} disabled={disabled} />
          <span className="field-hint">
            Anything the installer needs to know about the house before he gets there:
            access, where the shutoff is, stairs, a dog, a tenant. Printed on the work
            order.
          </span>
        </div>

        <div className="field field-full">
          <label htmlFor="edit_notes">Notes <span className="optional">(optional)</span></label>
          <textarea id="edit_notes" name="notes" rows="3"
            value={form.notes} onChange={onChange} disabled={disabled} />
          <span className="field-hint">For the office. Never leaves the building.</span>
        </div>
      </div>

      <p className="inv-ledger-note">
        The date, the time window, the crew, the pay and the install date are edited on
        the schedule and in the panels on the job itself, because each of those moves
        parts on the shelf when it changes.
      </p>
    </section>
  )
}
