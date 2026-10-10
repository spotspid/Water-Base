import { payoutNote, rateButtonLabel, rateValue, hasSuggestion } from '../lib/installRates'

// The line under the installer pay box.
//
// Two jobs, in one place so the drawer and the New job form cannot word it
// differently: say where the figure in the box came from, and give the one
// button that settles it.
//
// The button used to appear only when the box and the rate disagreed, which
// hid it in exactly the case where it was needed. The box starts on the rate,
// so the two agree, so there was no button, and the only way to put the rate
// on the job was to make the box dirty: delete the figure and type the same
// one back in. The work order will not send without pay on the job, so that
// retype was a required step that looked like a pointless one. Reported by
// David on 2026-10-10, who was right that somebody would ask why it will not
// send when the total is already there.
//
// Now there are two states and a button for each:
//
//   pending   the box shows the rate and the job does not hold it yet.
//             Confirm $400 puts it on the job. One press, nothing typed.
//   differs   somebody typed their own figure. Back to $400 returns to the
//             rate, which is what the button always did.
//
// Confirming stays a deliberate act rather than becoming automatic. The point
// of asking at all was that a payout leaving the building should be looked at
// once, and a figure that saves itself is one nobody ever looks at.
export default function PayRateHint({ suggestion, value, onUse, disabled, pending = false }) {
  if (!suggestion) return null

  const note = payoutNote(value, suggestion, { pending })
  const label = rateButtonLabel(suggestion, { pending })
  const differs = String(value ?? '').trim() !== rateValue(suggestion)
  const offer = hasSuggestion(suggestion) && (pending || differs)

  return (
    <span className="field-hint">
      {note}
      {offer && (
        <>
          {' '}
          <button
            type="button"
            className={pending ? 'tpl-link pay-confirm' : 'tpl-link'}
            disabled={disabled}
            onClick={() => onUse(rateValue(suggestion))}
          >
            {label}
          </button>
        </>
      )}
    </span>
  )
}
