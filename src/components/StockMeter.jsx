import { availableOf, committedOf } from '../lib/inventory'
import { arrivalState } from '../lib/orderState'

// The stock meter.
//
// One bar answers the question the reservation layer exists to answer: of what
// is on the shelf, how much can I still promise someone today.
//
//   teal          free to sell
//   hatched navy  promised to a booked job, still physically here
//   maroon        promised beyond what the shelf holds
//
// On order is deliberately not a fourth segment. The bar is about the shelf as
// it is right now, and colouring in stock that has not arrived would make an
// empty shelf look half full. It reads as a third figure in the key instead,
// where it can carry a date, because "none free, 4 on order for the 14th" is
// the sentence the whole thing exists to produce.
//
// Widths are computed against on hand plus any shortfall, so an oversold row
// still fills the track and the maroon segment is proportional to how far past
// the shelf the promises go.
//
// This reads the same helpers the rest of the app does, so it cannot disagree
// with the numbers in the columns beside it.
export default function StockMeter({ row, label = true }) {
  const onHand = Number(row?.on_hand) || 0
  const promised = committedOf(row)
  const available = availableOf(row)

  const arrival = arrivalState(row)
  const short = available < 0 ? Math.abs(available) : 0
  const free = available > 0 ? available : 0
  // promised that is actually covered by stock on the shelf
  const covered = Math.max(promised - short, 0)

  const total = free + covered + short
  const pct = value => (total > 0 ? (value / total) * 100 : 0)

  // an item with nothing on hand and nothing promised still needs a track,
  // otherwise the column reads as a rendering failure rather than as empty
  const empty = total === 0

  return (
    <div className="meter">
      <div
        className="meter-track"
        role="img"
        aria-label={short > 0
          ? `${short} short, ${covered} promised of ${onHand} on hand`
          : `${free} available, ${covered} promised of ${onHand} on hand`}
      >
        {!empty && free > 0 && (
          <span className="meter-seg meter-free" style={{ '--seg-width': `${pct(free)}%` }} />
        )}
        {!empty && covered > 0 && (
          <span className="meter-seg meter-promised" style={{ '--seg-width': `${pct(covered)}%` }} />
        )}
        {!empty && short > 0 && (
          <span className="meter-seg meter-short" style={{ '--seg-width': `${pct(short)}%` }} />
        )}
      </div>

      {label && (
        <div className="meter-key">
          {short > 0 ? (
            <span className="meter-key-short"><b>{short}</b> short</span>
          ) : (
            <span><b>{free}</b> free</span>
          )}
          {covered > 0
            ? <span><b>{covered}</b> promised</span>
            : <span>none promised</span>}
          {arrival.state !== 'none' && (
            <span className={arrival.state === 'overdue' ? 'meter-key-late' : 'meter-key-coming'}>
              <b>{arrival.onOrder}</b> on order
            </span>
          )}
        </div>
      )}
    </div>
  )
}
