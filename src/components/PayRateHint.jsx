import { payoutNote, rateButtonLabel, rateValue, hasSuggestion } from '../lib/installRates'

// The line under the installer pay box.
//
// Two jobs, in one place so the drawer and the New job form cannot word it
// differently: say where the figure in the box came from, and say what a typed
// figure does to it when the two disagree.
//
// The box starts on the rate, so most of the time this is a provenance line
// rather than an offer. The button appears only when the two have parted
// company, and then it means back to the rate rather than use it.
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
