// What an order still owes, as arithmetic.
//
// Kept out of orders.js because that module imports the Supabase client, which
// reads import.meta.env and therefore cannot be loaded by Node. These rules are
// exactly the kind that should be tested rather than trusted, so they live
// where npm run check can reach them.

/**
 * How many units on a line are still to come.
 *
 * Reads quantity_outstanding when the view supplied it and falls back to the
 * subtraction, so a column added in a later migration cannot make every line
 * look fully received. A negative is clamped, because more received than
 * ordered is a data problem to fix on the order rather than a negative to
 * carry into a filter.
 */
export function outstandingOf(line) {
  const direct = Number(line?.quantity_outstanding)
  if (Number.isFinite(direct)) return Math.max(direct, 0)

  const ordered = Number(line?.quantity_ordered) || 0
  const received = Number(line?.quantity_received) || 0
  return Math.max(ordered - received, 0)
}

export function isOutstanding(line) {
  return outstandingOf(line) > 0
}

/**
 * The lines still owed, or all of them.
 *
 * Returns the same array when nothing is filtered, so React sees one reference
 * and does not re-render the table for a toggle that changed nothing.
 */
export function filterOutstanding(lines, only) {
  const list = lines || []
  return only ? list.filter(isOutstanding) : list
}

export function countOutstanding(lines) {
  return (lines || []).filter(isOutstanding).length
}
