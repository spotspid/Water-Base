import { supabase } from './supabase.js'
import { attempt } from './errors.js'

// Reading and writing supplier orders.
//
// How they read on screen is in orderState.js, which imports nothing so the
// repo check can run it. This half is only the round trips.

const ORDER_COLUMNS =
  'id, created_at, supplier, order_number, order_date, expected_arrival, status, '
  + 'freight_amount, tax_amount, invoice_total, notes, received_at, line_count, '
  + 'units_ordered, units_received, units_outstanding, subtotal, order_total, entry_balance'

const LINE_COLUMNS =
  'id, order_id, item_id, quantity_ordered, quantity_received, quantity_outstanding, '
  + 'unit_cost, note, sku, item_name, variant, category, catalog_unit_cost, '
  + 'extended_cost, allocated_extra, landed_unit_cost, order_status, order_number, supplier'

export async function fetchOrders() {
  return attempt(
    () => supabase.from('supplier_order_summary').select(ORDER_COLUMNS)
      .order('order_date', { ascending: false }),
    'Supplier orders could not be loaded.',
  )
}

export async function fetchOrderLines(orderId) {
  return attempt(
    () => supabase.from('supplier_order_lines_costed').select(LINE_COLUMNS)
      .eq('order_id', orderId).order('created_at', { ascending: true }),
    'The lines on this order could not be loaded.',
  )
}

export async function saveOrder(order, id) {
  return attempt(
    () => (id
      ? supabase.from('supplier_orders').update(order).eq('id', id).select('id').single()
      : supabase.from('supplier_orders').insert(order).select('id').single()),
    id ? 'The order could not be saved.' : 'The order could not be created.',
  )
}

export async function addOrderLine(line) {
  return attempt(
    () => supabase.from('supplier_order_lines').insert(line).select('id').single(),
    'That line could not be added.',
  )
}

export async function removeOrderLine(id) {
  return attempt(
    () => supabase.from('supplier_order_lines').delete().eq('id', id),
    'That line could not be removed.',
  )
}

/**
 * Receives part or all of one line.
 *
 * The database writes the purchase transaction, so nothing here decides what a
 * unit cost. Passing the landed figure up from the browser would be one more
 * place for it to be wrong.
 */
export async function receiveLine(lineId, quantity, note) {
  return attempt(
    () => supabase.rpc('receive_order_line', {
      p_line_id: lineId,
      p_quantity: quantity,
      p_note: note || null,
    }),
    'That delivery could not be recorded.',
  )
}
