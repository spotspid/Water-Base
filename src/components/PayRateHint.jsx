import { payoutNote, rateButtonLabel, rateValue, hasSuggestion } from '../lib/installRates'

// The line under the installer pay box.
//
// Three jobs, in one place so the drawer and the New job form cannot word it
// differently: say what the rate is and where it came from, offer to put it in
// the box, and say what the typed figure does to it when the two disagree.
//
// The button is the only thing that writes, and only when it is pressed. A
// form that filled the box in on its own would turn a rate card into a payroll
// decision nobody made, and the whole reason this exists is that a figure
// nobody could account for ended up on a job.
export default function PayRateHint({ suggestion, value, onUse, disabled }) {
  if (!suggestion) return null

  const note = payoutNote(value, suggestion)
  const label = rateButtonLabel(suggestion)
  const offer = hasSuggestion(suggestion)
    && String(value ?? '').trim() !== rateValue(suggestion)

  return (
    <span className="field-hint">
      {note}
      {offer && (
        <>
          {' '}
          <button type="button" className="tpl-link" disabled={disabled}
            onClick={() => onUse(rateValue(suggestion))}>
            {label}
          </button>
        </>
      )}
    </span>
  )
}
