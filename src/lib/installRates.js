// What an install costs us to have done, as a reference while quoting.
//
// These are the rates agreed with the installer. They are here so somebody
// pricing a job in the house can see what the install side of it will cost
// before they name a number, rather than guessing and finding out on the work
// order.
//
// Reference only. Nothing here sets installer pay. The pay on a job is typed
// on the job, because it varies by installer, by drive and by what is found on
// site, and a rate card that quietly filled that field in would turn an
// estimate into a promise nobody made.
//
// A base rate and its extras are separate lists because they add differently:
// exactly one base applies to a job, and any number of extras stack on top.
//
// Pure and importing nothing, so npm run check can read it under Node.

// amount  dollars, or null when the rate is per unit rather than flat
// per     what the amount is charged against, when it is not the whole job
export const BASE_RATES = [
  { id: 'softener', label: 'Softener plus brine tank', amount: 400 },
  { id: 'ro', label: 'Tankless or tanked RO, under sink', amount: 250 },
  { id: 'dual', label: 'Dual tank setup, with or without brine tank', amount: 500 },
  { id: 'softener_ro', label: 'Softener plus brine tank, and RO install', amount: 500 },
  { id: 'dual_ro', label: 'Dual tank setup with or without brine tank, and RO install', amount: 600 },
]

export const EXTRA_RATES = [
  { id: 'countertop', label: 'Drilling a stone or tile countertop', amount: 75 },
  { id: 'fridge', label: 'Fridge hookup or extra faucet', amount: 75, per: 'each' },
  { id: 'dishwasher', label: 'Electrical plug to the dishwasher', amount: 75 },
  { id: 'bypass', label: 'Bypass valve', amount: 50 },
  { id: 'ro_basement', label: 'RO installed in the basement', amount: 75, per: 'on top of the normal RO price' },
  { id: 'long_run', label: 'Drain or supply line over 25 feet', amount: 4, per: 'per foot' },
  { id: 'return_trip', label: 'Return trip', amount: 175 },
  { id: 'service_call', label: 'Service call', amount: 175 },
]

/**
 * A rate as money, in whole dollars.
 *
 * Every rate on this card is a whole number today, so there are no cents to
 * show, and printing them would only add noise to a column somebody is
 * scanning down.
 */
export function rateAmount(rate) {
  const n = Number(rate?.amount)
  if (!Number.isFinite(n)) return ''
  return `$${n.toLocaleString('en-US')}`
}
