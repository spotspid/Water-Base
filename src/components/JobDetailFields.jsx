import { useSettings, withCurrent } from '../lib/settings'
import { useInstallers } from '../lib/useInstallers'

// The scheduling half of the job form. Installer and helper are picked from
// the roster rather than typed, so the calendar can group by person and a
// rename does not strand a job under a name nobody uses any more.
export default function JobDetailFields({ form, onChange, disabled, payHint }) {
  const { timeWindows, loading: loadingSettings } = useSettings()
  const { installers, loading: loadingCrew, error: crewError } = useInstallers({ activeOnly: true })

  const windowOptions = withCurrent(timeWindows || [], form.time_window)

  return (
    <section className="form-section">
      <h2>Job Details</h2>

      {crewError && (
        <p className="form-warning" role="alert">
          {crewError} The job can still be saved, but no one can be assigned to it yet.
        </p>
      )}

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
          <label htmlFor="scheduled_date">Scheduled Date <span className="optional">(optional)</span></label>
          <input id="scheduled_date" name="scheduled_date" type="date"
            value={form.scheduled_date} onChange={onChange} disabled={disabled} />
          <span className="field-hint">The day it is promised. Puts the job on the schedule.</span>
        </div>
        <div className="field">
          <label htmlFor="time_window">Time Window <span className="optional">(optional)</span></label>
          <select id="time_window" name="time_window"
            value={form.time_window} onChange={onChange} disabled={disabled || loadingSettings}>
            <option value="">{loadingSettings ? 'Loading windows...' : 'No window'}</option>
            {windowOptions.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="installer_id">Installer <span className="optional">(optional)</span></label>
          <select id="installer_id" name="installer_id"
            value={form.installer_id} onChange={onChange} disabled={disabled || loadingCrew}>
            <option value="">{loadingCrew ? 'Loading crew...' : 'Unassigned'}</option>
            {installers.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <span className="field-hint">Managed on the Settings page.</span>
        </div>
        <div className="field">
          <label htmlFor="helper_id">Helper <span className="optional">(optional)</span></label>
          <select id="helper_id" name="helper_id"
            value={form.helper_id} onChange={onChange} disabled={disabled || loadingCrew}>
            <option value="">None</option>
            {installers
              .filter(i => i.id !== form.installer_id)
              .map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="install_date">Install Date <span className="optional">(optional)</span></label>
          <input id="install_date" name="install_date" type="date"
            value={form.install_date} onChange={onChange} disabled={disabled} />
          <span className="field-hint">The day it actually happened. Left blank until then.</span>
        </div>
        <div className="field">
          <label htmlFor="payout_amount">Payout Amount ($) <span className="optional">(optional)</span></label>
          <input id="payout_amount" name="payout_amount" type="number" min="0" step="0.01"
            value={form.payout_amount} onChange={onChange} disabled={disabled} />
          {payHint && <span className="field-hint">{payHint}</span>}
        </div>
        <div className="field field-full">
          <label htmlFor="site_conditions">
            Site Conditions <span className="optional">(optional)</span>
          </label>
          <textarea id="site_conditions" name="site_conditions" rows="3"
            value={form.site_conditions} onChange={onChange} disabled={disabled} />
          <span className="field-hint">
            Anything the installer needs to know about the house before he gets there:
            access, where the shutoff is, stairs, a dog, a tenant. Printed on the work
            order. Leave it blank if there is nothing worth saying.
          </span>
        </div>
        <div className="field field-full">
          <label htmlFor="notes">Notes <span className="optional">(optional)</span></label>
          <textarea id="notes" name="notes" rows="3"
            value={form.notes} onChange={onChange} disabled={disabled} />
          <span className="field-hint">For the office. Never leaves the building.</span>
        </div>
      </div>
    </section>
  )
}
