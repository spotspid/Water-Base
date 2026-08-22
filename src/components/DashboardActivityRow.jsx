import { costEffect } from '../lib/dashboard'
import { formatCurrency, formatDateTime, formatDay, formatSignedQty } from '../lib/inventory'

// One ledger row, as a table row. Used both for a loose entry and, indented,
// for each line inside an expanded group, so the two can never drift apart in
// how they present a quantity or a value.
export default function DashboardActivityRow({ row, typeLabel, reason, nested }) {
  return (
    <tr className={nested ? 'dash-act-line' : undefined}>
      <td className="col-nowrap" title={formatDateTime(row.created_at)}>
        {nested ? '' : formatDay(row.created_at)}
      </td>
      <td className="td-customer">
        {row.inventory_items?.name || 'Unknown item'}
        {row.inventory_items?.sku && (
          <span className="cell-sub">
            {row.inventory_items.sku}
            {row.inventory_items.variant ? `, ${row.inventory_items.variant}` : ''}
          </span>
        )}
      </td>
      <td>
        {nested
          ? ''
          : <span className={`txn-badge txn-${row.txn_type}`}>{typeLabel(row.txn_type)}</span>}
      </td>
      <td className={row.quantity < 0 ? 'col-num qty-out' : 'col-num qty-in'}>
        {formatSignedQty(row.quantity)}
      </td>
      <td className={costEffect(row) < 0 ? 'col-num col-value qty-out' : 'col-num col-value qty-in'}>
        {formatCurrency(costEffect(row))}
      </td>
      <td className="col-note">{nested ? '' : reason(row)}</td>
    </tr>
  )
}
