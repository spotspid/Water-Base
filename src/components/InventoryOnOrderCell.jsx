import { arrivalState } from '../lib/orderState'
import { formatLongDate } from '../lib/schedule'

// What is bought and not here yet, with the date it is expected.
//
// Teal while the date is still ahead and maroon once it has gone by, because a
// supplier who is late is a different problem from one who has not got there
// yet, and only one of them needs chasing. A quantity with no date says so
// rather than implying one.
export default function InventoryOnOrderCell({ row }) {
  const arrival = arrivalState(row)

  if (arrival.state === 'none') return <span className="inv-none">0</span>

  return (
    <span className={arrival.state === 'overdue' ? 'inv-late' : 'inv-coming'}>
      {arrival.onOrder}
      <span className="cell-sub">
        {arrival.date
          ? `${arrival.state === 'overdue' ? 'due ' : ''}${formatLongDate(arrival.date)}`
          : 'no date'}
      </span>
    </span>
  )
}
