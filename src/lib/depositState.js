// How a job's money reads on screen.
//
// Pure and importing nothing, so the repo check can run it. The querying half
// is in deposits.js.
//
// The only real judgement here is what to call a balance. Sale price minus
// deposits is a subtraction that can land on either side of zero, and each
// side means something different to whoever reads it: money still to collect,
// nothing to collect, or money owed back to the customer. Printing a negative
// balance and letting the reader work it out is how an installer ends up
// asking for minus eleven hundred dollars at somebody's front door.

// Below this, a difference is rounding rather than money.
const CENT = 0.005

export function depositsTaken(job) {
  const n = Number(job?.deposits_taken)
  return Number.isFinite(n) ? n : 0
}

/**
 * What is left to collect, and which of the three things that means.
 *
 *   due     there is money still to take
 *   settled the price is covered, nothing to collect
 *   credit  more has been taken than the job is worth, so it is owed back
 *
 * The amount is always returned positive, because the sign is carried by the
 * state rather than by the number. A caller that prints amount without reading
 * state gets a figure that is at worst incomplete rather than backwards.
 */
export function balanceState(job) {
  const price = Number(job?.sale_price) || 0
  const taken = depositsTaken(job)

  // Prefer the figure the database derived, so the page and the work order
  // cannot disagree, but fall back to the subtraction if the column is not
  // there yet.
  const raw = job?.balance_due == null ? price - taken : Number(job.balance_due) || 0

  if (raw > CENT) return { state: 'due', amount: raw, taken, price }
  if (raw < -CENT) return { state: 'credit', amount: Math.abs(raw), taken, price }
  return { state: 'settled', amount: 0, taken, price }
}

// Nothing taken yet, which is a normal and common state rather than a problem.
export function hasDeposits(job) {
  return (Number(job?.deposit_count) || 0) > 0
}

// A negative deposit is a refund. Saying so beats printing a minus sign and
// hoping, because the two rows sit next to each other in the same list.
export function isRefund(deposit) {
  return (Number(deposit?.amount) || 0) < 0
}

/**
 * How far through paying a job is, as a percentage.
 *
 * For a bar, not for a decision. There is no percentage logic anywhere in
 * deposits and this does not introduce any: it describes what happened after
 * the fact rather than deciding what should have.
 */
export function paidShare(job) {
  const price = Number(job?.sale_price) || 0
  if (price <= 0) return null

  const share = (depositsTaken(job) / price) * 100
  return Math.max(0, Math.min(100, share))
}
