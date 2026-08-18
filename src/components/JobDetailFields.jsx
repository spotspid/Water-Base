export default function JobDetailFields({ form, onChange, disabled, payHint }) {
  return (
    <section className="form-section">
      <h2>Job Details</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="status">Status</label>
          <select id="status" name="status" required
            value={form.status} onChange={onChange} disabled={disabled}>
            <option value="sold">Sold</option>
            <option value="scheduled">Scheduled</option>
            <option value="installed">Installed</option>
          </select>
          {form.status === 'installed' && (
            <span className="field-hint">Saving will deduct the parts list above.</span>
          )}
        </div>
        <div className="field">
          <label htmlFor="invoice_number">Invoice Number</label>
          <input id="invoice_number" name="invoice_number" type="text" required
            value={form.invoice_number} onChange={onChange} disabled={disabled} />
        </div>
        <div className="field">
          <label htmlFor="install_date">Install Date <span className="optional">(optional)</span></label>
          <input id="install_date" name="install_date" type="date"
            value={form.install_date} onChange={onChange} disabled={disabled} />
        </div>
        <div className="field">
          <label htmlFor="installer">Installer <span className="optional">(optional)</span></label>
          <input id="installer" name="installer" type="text"
            value={form.installer} onChange={onChange} disabled={disabled} />
        </div>
        <div className="field">
          <label htmlFor="payout_amount">Payout Amount ($) <span className="optional">(optional)</span></label>
          <input id="payout_amount" name="payout_amount" type="number" min="0" step="0.01"
            value={form.payout_amount} onChange={onChange} disabled={disabled} />
          {payHint && <span className="field-hint">{payHint}</span>}
        </div>
        <div className="field field-full">
          <label htmlFor="notes">Notes <span className="optional">(optional)</span></label>
          <textarea id="notes" name="notes" rows="3"
            value={form.notes} onChange={onChange} disabled={disabled} />
        </div>
      </div>
    </section>
  )
}
