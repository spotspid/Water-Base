// The RO type and faucet finish, and the one rule that ties them together.
//
// "No RO" is a job that takes the whole home system without a drinking water
// unit. It has no RO faucet either, so its faucet finish is "N/A". That is the
// only place N/A belongs: on a job that has an RO it would leave the RO with
// no faucet, and nobody would find out until the installer opened the box.
//
// The database holds the same rule in the jobs_ro_picks trigger, so a job
// written any other way still cannot break it. This copy is here so the form
// can follow the rule as it is filled in, rather than saying no on save.
//
// Pure and importing nothing, so npm run check can run it under Node.

export const NO_RO = 'No RO'
export const FAUCET_NA = 'N/A'

/**
 * A form after one pick changes, with the other pick kept in step.
 *
 * Picking No RO sets the faucet to N/A, so saying no RO is one choice rather
 * than two that have to agree. Bringing the RO back clears N/A to blank,
 * because the RO now needs a real finish and N/A is not one.
 */
export function applyRoPick(form, name, value) {
  const next = { ...form, [name]: value }
  if (name !== 'ro_type') return next

  if (value === NO_RO) next.faucet_finish = FAUCET_NA
  else if (form.faucet_finish === FAUCET_NA) next.faucet_finish = ''
  return next
}

/**
 * The finishes the faucet dropdown offers for this RO type.
 *
 * With No RO there is exactly one answer. Otherwise N/A is left out, so it
 * cannot be picked for a job that has an RO. A job already holding something
 * else is given its own value back, so opening an old job never shows a blank
 * where its finish was.
 */
export function faucetChoices(finishes, roType, current = '') {
  if (roType === NO_RO) return [FAUCET_NA]
  const list = (finishes || []).filter(f => f !== FAUCET_NA)
  if (current && current !== FAUCET_NA && !list.includes(current)) list.push(current)
  return list
}

/**
 * The first thing wrong with the two picks together, or an empty string.
 * Worded as the trigger words it, so the form and the database say the same.
 */
export function roPickProblem(form) {
  const ro = form?.ro_type || ''
  const faucet = form?.faucet_finish || ''
  if (faucet === FAUCET_NA && ro !== NO_RO) {
    return 'Faucet finish N/A is only for a job with no RO. Pick a finish, or set the RO type to No RO.'
  }
  if (ro === NO_RO && faucet !== FAUCET_NA) {
    return 'A job with no RO has no faucet. Its faucet finish is N/A.'
  }
  return ''
}
