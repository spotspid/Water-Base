// How many columns a row of cards should have, so the last row is never one
// orphan sitting under a full one.
//
// Pure and importing nothing, so npm run check can run it under Node.

/**
 * The column count for `count` cards when at most `maxCols` fit across.
 *
 * Everything fits on one row when it can. Otherwise the split with the fewest
 * empty cells on the last row wins, and a tie goes to the wider layout. Five
 * cards in a four column space become three and two rather than four and one;
 * six in a five column space become three and three.
 *
 * Never drops below two columns unless only one fits, because a single stack
 * of five tiles is a worse answer than two columns with a short last row.
 */
export function fitColumns(count, maxCols) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  const max = Math.max(1, Math.floor(Number(maxCols) || 1))

  if (n <= max) return Math.max(1, n)
  if (max === 1) return 1

  const floor = Math.max(2, Math.ceil(max / 2))
  let best = max
  let bestGap = Infinity

  for (let cols = max; cols >= floor; cols--) {
    const gap = (cols - (n % cols)) % cols
    if (gap < bestGap) {
      bestGap = gap
      best = cols
    }
    if (gap === 0) break
  }

  return best
}

/**
 * How many cards of at least `minWidth` fit across `width`, with `gap`
 * between them. Zero width, which is what a hidden element measures, gives
 * one column rather than a division by nothing.
 */
export function columnsThatFit(width, minWidth, gap) {
  const w = Number(width) || 0
  const min = Math.max(1, Number(minWidth) || 1)
  const g = Math.max(0, Number(gap) || 0)
  return Math.max(1, Math.floor((w + g) / (min + g)))
}
