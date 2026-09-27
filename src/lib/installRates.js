// What an install costs us to have done, and what to put in the pay box.
//
// The rates themselves are no longer here. They are rows now, in
// install_rate_lines and installer_rates, because there is about to be a third
// installer and "the rate" stopped being one number the day there were two.
// What stays here is the wording and the arithmetic, which is the part worth
// testing: pure, importing nothing, so npm run check can read it under Node.
//
// The suggestion is offered and never imposed. A rate card that filled the pay
// box in and moved on would turn an estimate into a promise nobody made, so
// the form shows the figure, says where it came from, and leaves the box to
// the person. What is new is that a typed figure can now be compared against
// the rate, which is how a $1,600 payout on a $600 job gets noticed.

/**
 * A rate as money, in whole dollars.
 *
 * Every rate on the card is a whole number today, so there are no cents to
 * show, and printing them would only add noise to a column somebody is
 * scanning down.
 */
export function rateAmount(rate) {
  const n = Number(rate?.amount ?? rate)
  if (!Number.isFinite(n)) return ''
  return `$${n.toLocaleString('en-US')}`
}

// A rate line with its own per clause read as one phrase: "$75 each",
// "$4 per foot", or just "$50".
export function rateLine(rate) {
  const money = rateAmount(rate)
  const per = String(rate?.per || '').trim()
  return per ? `${money} ${per}` : money
}

/**
 * Whether a suggestion can be offered at all.
 *
 * The database answers with a row either way, so a form can say why there is
 * nothing to suggest as easily as it can show a figure.
 */
export function hasSuggestion(suggestion) {
  const n = Number(suggestion?.amount)
  return Number.isFinite(n) && suggestion?.source !== 'none'
}

/**
 * How a typed payout stands against the rate.
 *
 *   unset     nothing typed. The suggestion is the offer.
 *   matches   typed and equal to the rate.
 *   over      typed and higher, which is allowed and worth saying.
 *   under     typed and lower, same.
 *   no_rate   nothing to compare against, so the typed figure stands alone.
 *
 * Compared as numbers to the cent, because "400" and "400.00" are the same
 * agreement written two ways and a form that called them different would nag
 * about a job nobody had touched.
 */
export function payoutStanding(payout, suggestion) {
  const typed = Number(payout)
  const hasTyped = payout !== null && payout !== undefined
    && String(payout).trim() !== '' && Number.isFinite(typed)

  if (!hasSuggestion(suggestion)) return hasTyped ? 'no_rate' : 'no_rate'
  if (!hasTyped) return 'unset'

  const rate = Number(suggestion.amount)
  if (Math.abs(typed - rate) < 0.005) return 'matches'
  return typed > rate ? 'over' : 'under'
}

/**
 * The sentence under the pay box.
 *
 * The database composes the provenance half, because it is the half that knows
 * whether the figure is this installer's own rate or the card's. This adds
 * what the typed figure does to it, which is the half the form knows.
 */
export function payoutNote(payout, suggestion) {
  const standing = payoutStanding(payout, suggestion)

  if (standing === 'no_rate') {
    return String(suggestion?.reason || 'There is no rate line for this job, so the pay is typed.')
  }

  const reason = String(suggestion?.reason || '').trim()

  if (standing === 'unset') return reason
  if (standing === 'matches') return `${reason} This job is on the rate.`

  const typed = rateAmount({ amount: Number(payout) })
  const word = standing === 'over' ? 'above' : 'below'
  const gap = rateAmount({ amount: Math.abs(Number(payout) - Number(suggestion.amount)) })

  return `${reason} ${typed} is ${gap} ${word} it, which is allowed and stays as typed.`
}

// What the "use the rate" button says, or an empty string when there is
// nothing to offer. Not named useSomething: it is a sentence, not a hook, and
// the linter is right to insist on the difference.
export function rateButtonLabel(suggestion) {
  return hasSuggestion(suggestion) ? `Use ${rateAmount(suggestion)}` : ''
}

// The value that button writes into the box. A string, because the box is a
// text input and a number would arrive as "400" one day and "400.00" another
// depending on what the database rounded.
export function rateValue(suggestion) {
  if (!hasSuggestion(suggestion)) return ''
  const n = Number(suggestion.amount)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
