// Parts that have reached their reorder point but still have stock free to
// sell. Time to buy, not time to panic.
//
// This list used to sit on the dashboard mixed in with genuine shortages,
// where it was most of what the dashboard said. It belongs here, on the page
// with the button that logs the purchase.
//
// A part with nothing free to sell is deliberately not here. That is the more
// serious problem, it is reported on the dashboard, and listing it in both
// places is what made either list hard to trust.
export default function InventoryReorder({ rows }) {
  if (rows.length === 0) return null

  return (
    <section className="inv-reorder" aria-labelledby="inv-reorder-head">
      <h2 id="inv-reorder-head" className="inv-reorder-head">
        At the reorder point
      </h2>
      <ul className="inv-reorder-list">
        {rows.map(row => (
          <li key={row.id} className="inv-reorder-row">
            <span className="inv-reorder-name">
              {row.name}
              <span className="cell-sub">
                {[row.sku, row.variant].filter(Boolean).join(', ')}
              </span>
            </span>
            <span className="inv-reorder-figures">
              <b>{row.on_hand}</b> on hand, reorder at <b>{row.reorder_threshold}</b>,
              {' '}<b>{row.free}</b> free to sell
            </span>
          </li>
        ))}
      </ul>
      <p className="inv-reorder-foot">
        Reorder points come from what a job actually consumes, so a part at the line
        still covers the next install and no more.
      </p>
    </section>
  )
}
