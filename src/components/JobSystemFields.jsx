import { useSettings } from '../lib/settings'
import JobPartsPreview from './JobPartsPreview'

// What is being sold and what it costs, plus the live parts preview for the
// chosen template. Split out of NewJob so that page stays about the form's
// state and submission rather than about markup, and shared with the edit form
// so the two cannot drift apart.
//
// lockedPicks is an installed job. The sheet and the three picks decided which
// items left the shelf, and the ledger rows recording that are append only, so
// they are shown and not editable.
//
// hidePreview is for the edit form, where the drawer already shows the job's
// resolved parts underneath and a second copy resolving the template alone
// would disagree with it on any job carrying its own parts list.
//
// templateOptional is a job that lists its own parts and therefore needs no
// sheet at all.
export default function JobSystemFields({
  form, onChange, disabled, templates, loadingTemplates, templateError, onReloadTemplates,
  selectedTemplate, lockedPicks = false, hidePreview = false, templateOptional = false,
}) {
  const {
    finishes, roTypes, valveTypes, paymentTypes, loading: loadingSettings,
  } = useSettings()

  return (
    <section className="form-section">
      <h2>System</h2>

      {templateError && (
        <div className="inv-error-box" role="alert">
          <p className="inv-error-detail">{templateError}</p>
          <button type="button" className="btn-cancel" onClick={onReloadTemplates}>Try again</button>
        </div>
      )}

      {!templateError && !loadingTemplates && templates.length === 0 && (
        <p className="form-warning" role="status">
          No active system templates exist. Create one on the Templates page first.
        </p>
      )}

      <div className="form-grid">
        <div className="field">
          <label htmlFor="system_template">System template</label>
          <select id="system_template" name="system_template" required={!templateOptional}
            value={form.system_template} onChange={onChange}
            disabled={disabled || lockedPicks || loadingTemplates || templates.length === 0}>
            <option value="">
              {loadingTemplates ? 'Loading templates...' : 'Select system...'}
            </option>
            {templates.map(t => <option key={t.id} value={t.label}>{t.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sale_price">Sale price ($)</label>
          <input id="sale_price" name="sale_price" type="number" min="0" step="0.01" required
            value={form.sale_price} onChange={onChange} disabled={disabled} />
        </div>
        <div className="field">
          <label htmlFor="faucet_finish">Faucet finish</label>
          <select id="faucet_finish" name="faucet_finish" required
            value={form.faucet_finish} onChange={onChange}
            disabled={disabled || lockedPicks || loadingSettings}>
            <option value="">
              {loadingSettings ? 'Loading finishes...' : 'Select finish...'}
            </option>
            {finishes.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <span className="field-hint">Decides which faucet the template consumes.</span>
        </div>
        <div className="field">
          <label htmlFor="ro_type">RO type</label>
          <select id="ro_type" name="ro_type" required
            value={form.ro_type} onChange={onChange}
            disabled={disabled || lockedPicks || loadingSettings}>
            <option value="">
              {loadingSettings ? 'Loading RO types...' : 'Select RO type...'}
            </option>
            {roTypes.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <span className="field-hint">
            Decides which RO unit the build sheet consumes. Same price either way.
          </span>
        </div>
        <div className="field">
          <label htmlFor="valve_type">
            Valve type <span className="optional">(whole home systems)</span>
          </label>
          <select id="valve_type" name="valve_type"
            value={form.valve_type} onChange={onChange}
            disabled={disabled || lockedPicks || loadingSettings}>
            <option value="">
              {loadingSettings ? 'Loading valve types...' : 'Not chosen'}
            </option>
            {valveTypes.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <span className="field-hint">
            Which control valve the build sheet takes off the shelf. A sheet with a
            valve line will not install until one is chosen. RO only needs none.
          </span>
        </div>
        <div className="field">
          <label htmlFor="payment_type">Payment type</label>
          <select id="payment_type" name="payment_type" required
            value={form.payment_type} onChange={onChange}
            disabled={disabled || loadingSettings}>
            <option value="">
              {loadingSettings ? 'Loading payment types...' : 'Select type...'}
            </option>
            {paymentTypes.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {!hidePreview && (
        <JobPartsPreview
          templateId={selectedTemplate?.id || ''}
          templateLabel={form.system_template}
          faucetFinish={form.faucet_finish}
          roType={form.ro_type}
          valveType={form.valve_type}
        />
      )}
    </section>
  )
}
