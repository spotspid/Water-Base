import { useFitColumns } from '../lib/useFitColumns'

// A row of metric cards whose column count follows the number of cards.
//
// auto-fit picks columns from the width alone, which is how five tiles ended
// up as four and an orphan. The count is known, so the grid is told the split
// that leaves no card on its own. The stylesheet's auto-fit rule still applies
// until the first measurement, so nothing flashes unstyled.
export default function StatGrid({
  count, minWidth = 180, gap = 16, className = 'inv-summary', children,
}) {
  const [ref, cols] = useFitColumns(count, { minWidth, gap })

  const style = cols
    ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }
    : undefined

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  )
}
