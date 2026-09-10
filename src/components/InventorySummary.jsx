import { formatCurrency } from '../lib/inventory'
import StatGrid from './StatGrid'

// The six figures over the inventory table.
//
// The category filter is not here any more. It sat in this row in a card
// sized slot, and a dropdown beside five numbers read as a sixth statistic.
// It lives on its own line above the table it filters.
export default function InventorySummary({
  totalValue, itemCount, committedUnits, lowCount, shortCount, onOrderUnits,
}) {
  return (
    <StatGrid count={6}>
      <div className="inv-stat inv-stat-lead">
        <span className="inv-stat-label">Value on hand</span>
        <span className="inv-stat-value">{formatCurrency(totalValue)}</span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-label">Items</span>
        <span className="inv-stat-value">{itemCount}</span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-label">Promised to booked jobs</span>
        <span className="inv-stat-value">{committedUnits}</span>
      </div>
      <div className={lowCount > 0 ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
        <span className="inv-stat-label">Needs reordering</span>
        <span className="inv-stat-value">{lowCount}</span>
      </div>
      <div className={shortCount > 0 ? 'inv-stat inv-stat-alert' : 'inv-stat'}>
        <span className="inv-stat-label">Short</span>
        <span className="inv-stat-value">{shortCount}</span>
      </div>
      <div className="inv-stat">
        <span className="inv-stat-label">On order</span>
        <span className="inv-stat-value">{onOrderUnits}</span>
      </div>
    </StatGrid>
  )
}
