// What an install costs us to have done, and what to put in the pay box.
//
// The rates themselves are no longer here. They are rows now, in
// install_rate_lines and installer_rates, because there is about to be a third
// installer and "the rate" stopped being one number the day there were two.
// What stays here is the wording and the arithmetic, which is the part worth
// testing: pure, importing nothing, so npm run check can read it under Node.
//
// The rate fills the box, and says where it came from.
//
// It was offered behind a button at first, on the reasoning that a card which
// filled the box in would turn an estimate into a promise. In practice that
// left the box blank on every new job and the figure got typed from memory
// anyway, which is the thing this exists to stop. So the box starts on the
// rate and the line underneath names whose rate it is.
//
// It follows the installer until somebody types their own figure, the same
// rule the deposit follows the price by in depositState.js: a number a person
// chose is theirs, and a later change to the job must not quietly overwrite
// it. Once typed, the rate becomes a comparison rather than a value.

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
export function payoutNote(payout, suggestion, { pending = false } = {}) {
  const standing = payoutStanding(payout, suggestion)
  // The box holds the rate and the job does not hold it yet. Four words,
  // because a figure that looks settled and is not is worse than a blank.
  const tail = pending ? ' Not on the job yet.' : ''

  if (standing === 'no_rate') {
    return String(suggestion?.reason || 'There is no rate line for this job, so the pay is typed.')
  }

  const reason = String(suggestion?.reason || '').trim()

  // The box holds the rate, which is the ordinary state now that it starts
  // there. Say whose rate it is and that it can be typed over.
  if (standing === 'unset') return `${reason}${tail}`
  if (standing === 'matches') return `${reason} Type over it to pay something else.${tail}`

  const typed = rateAmount({ amount: Number(payout) })
  const word = standing === 'over' ? 'above' : 'below'
  const gap = rateAmount({ amount: Math.abs(Number(payout) - Number(suggestion.amount)) })

  return `${reason} ${typed} is ${gap} ${word} it, which is allowed and stays as typed.`
}

// What the "back to the rate" button says, or an empty string when there is
// nothing to offer. Not named useSomething: it is a sentence, not a hook, and
// the linter is right to insist on the difference.
export function rateButtonLabel(suggestion) {
  return hasSuggestion(suggestion) ? `Back to ${rateAmount(suggestion)}` : ''
}

/**
 * What the pay box should hold.
 *
 * Untouched, it holds the rate and follows it: change the installer and the
 * figure becomes that installer's rate, because nobody has said otherwise.
 * Touched, it holds whatever was typed and nothing moves it again, which is
 * what makes a deliberate $800 on a $600 job survive a crew change.
 *
 * A job that already carries a payout counts as touched from the start. The
 * figure on it was somebody's decision, made once, and reopening the drawer is
 * not a reason to revisit it.
 */
export function payoutForBox({ current, suggestion, touched }) {
  if (touched) return current
  if (!hasSuggestion(suggestion)) return current
  return rateValue(suggestion)
}

// The value that button writes into the box. A string, because the box is a
// text input and a number would arrive as "400" one day and "400.00" another
// depending on what the database rounded.
export function rateValue(suggestion) {
  if (!hasSuggestion(suggestion)) return ''
  const n = Number(suggestion.amount)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
