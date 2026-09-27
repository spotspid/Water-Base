import { installerLabel } from '../lib/useInstallers'
import PayRateHint from './PayRateHint'

// Who is on the job and what they are paid. Three boxes and a number.
//
// It used to be six. The valve type belongs with the other two choices that
// decide which parts go on the truck, which is the System section, and the
// balance collected by belongs with the payments it is about. Both were here
// because this panel was the first one that could save, not because a person
// looking for them would come here.
//
// The invoice number stays visible because the work order will not send
// without it, but it is read here and edited in the job details form, where
// every other job field is edited. Two live boxes for the same value in two
// panels is how one of them ends up stale.
export default function CrewPayFields({
  draft, onChange, onCommitPay, onUsePay, busy, installers, loadingCrew,
  suggestion, payPending, invoiceNumber, onEditInvoice,
}) {
  return (
    <div className="form-grid">
      <div className="field">
        <label htmlFor="crew_installer">Installer</label>
        <select id="crew_installer" name="installer_id" value={draft.installer_id}
          onChange={onChange} disabled={busy || loadingCrew}>
          <option value="">{loadingCrew ? 'Loading crew...' : 'Unassigned'}</option>
          {installers.map(i => (
            <option key={i.id} value={i.id} disabled={!i.active}>{installerLabel(i)}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="crew_helper">Helper <span className="optional">(optional)</span></label>
        <select id="crew_helper" name="helper_id" value={draft.helper_id}
          onChange={onChange} disabled={busy || loadingCrew}>
          <option value="">None</option>
          {installers.filter(i => i.id !== draft.installer_id).map(i => (
            <option key={i.id} value={i.id} disabled={!i.active}>{installerLabel(i)}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="crew_payout">Installer pay ($)</label>
        {/* Saved on the way out of the box, or on Enter. Per keystroke would
            write four rows on the way to 4000. */}
        <input id="crew_payout" name="payout_amount" type="number" min="0" step="0.01"
          value={draft.payout_amount} onChange={onChange} disabled={busy}
          onBlur={onCommitPay}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onCommitPay() } }} />
        {/* The rate for this sheet and this installer, offered rather than
            written in. It follows the crew box above, so changing who is on
            the job changes the figure before anything is saved. */}
        <PayRateHint
          suggestion={suggestion}
          value={draft.payout_amount}
          disabled={busy}
          pending={payPending}
          onUse={onUsePay}
        />
        <span className="field-hint">Blank means not set, which is not the same as zero.</span>
      </div>

      <div className="field">
        <span className="inv-stat-label">Invoice number</span>
        <span className="inv-stat-value">
          {String(invoiceNumber || '').trim()
            || <span className="cell-unset">Not set</span>}
        </span>
        <span className="field-hint">
          The work order will not send without it.
          {' '}
          <button type="button" className="tpl-link" onClick={onEditInvoice} disabled={busy}>
            Edit
          </button>
        </span>
      </div>

    </div>
  )
}
