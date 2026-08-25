-- Receiving sets the catalogue cost to what the delivery actually cost.
--
-- Stock value was being worked out from a price somebody typed when the part
-- was first added, which drifts the moment a supplier changes theirs. Landing
-- four mixed beds at 716.42 while the catalogue still says 848.58 values the
-- shelf at a number nobody paid.
--
-- History cannot move as a result, and does not. Every ledger row carries
-- unit_cost_at_txn, stamped at the moment it was written, and job_margin sums
-- those rather than reading the catalogue. A job installed last month keeps
-- the parts cost it was installed at no matter what the shelf is worth today.
-- That separation was already the design; this only takes advantage of it.
--
-- The field stays an ordinary editable column. A receipt sets it, and a person
-- can still type over it, because a supplier price is a fact about one
-- delivery and there are reasons to hold a different figure.

create or replace function public.receive_order_line(
  p_line_id  uuid,
  p_quantity int,
  p_note     text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_line   record;
  v_txn_id uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Receive a quantity of at least one, not %', p_quantity
      using errcode = 'check_violation';
  end if;

  select * into v_line
  from public.supplier_order_lines_costed
  where id = p_line_id;

  if not found then
    raise exception 'That order line does not exist, or you cannot see it.'
      using errcode = 'no_data_found';
  end if;

  if v_line.order_status = 'cancelled' then
    raise exception 'That order is cancelled, so nothing can be received against it.'
      using errcode = 'check_violation';
  end if;

  if p_quantity > v_line.quantity_outstanding then
    raise exception
      'Only % of % are still outstanding on that line, so % cannot be received.',
      v_line.quantity_outstanding, v_line.quantity_ordered, p_quantity
      using errcode = 'check_violation';
  end if;

  -- the ledger entry, at the landed cost rather than the invoice price, so
  -- freight ends up in the value of the stock rather than nowhere
  insert into public.inventory_transactions
    (item_id, quantity, txn_type, unit_cost_at_txn, reference, note, source)
  values (
    v_line.item_id,
    p_quantity,
    'purchase',
    v_line.landed_unit_cost,
    coalesce(nullif(v_line.order_number, ''), v_line.supplier),
    coalesce(
      nullif(p_note, ''),
      format('Received against %s from %s',
             coalesce(nullif(v_line.order_number, ''), 'a supplier order'),
             v_line.supplier)),
    'manual'
  )
  returning id into v_txn_id;

  -- What the shelf is worth from here on. Only the catalogue price moves; the
  -- ledger row written above already holds its own cost and is never revisited.
  update public.inventory_items
  set unit_cost = v_line.landed_unit_cost
  where id = v_line.item_id
    and unit_cost is distinct from v_line.landed_unit_cost;

  -- the trigger on this update recomputes the order status, which in turn
  -- fires the arrival message when the last line lands
  update public.supplier_order_lines
  set quantity_received = quantity_received + p_quantity
  where id = p_line_id;

  return jsonb_build_object(
    'transaction_id',    v_txn_id,
    'item_id',           v_line.item_id,
    'sku',               v_line.sku,
    'quantity',          p_quantity,
    'landed_unit_cost',  v_line.landed_unit_cost,
    'landed_value',      round(v_line.landed_unit_cost * p_quantity, 2),
    'still_outstanding', v_line.quantity_outstanding - p_quantity,
    'order_status',      (select status from public.supplier_orders where id = v_line.order_id),
    -- what the catalogue said before this delivery, so the caller can say the
    -- price moved rather than changing it silently
    'previous_unit_cost', v_line.catalog_unit_cost,
    'unit_cost_changed',  v_line.catalog_unit_cost is distinct from v_line.landed_unit_cost
  );
end;
$fn$;

comment on function public.receive_order_line(uuid, int, text) is
  'Receives part or all of one order line. Writes a purchase transaction at '
  'the landed cost and sets the catalogue cost to match, so the shelf is '
  'valued at what was paid. Ledger rows keep the cost stamped on them, so no '
  'past job margin moves.';

grant execute on function public.receive_order_line(uuid, int, text) to authenticated;
revoke execute on function public.receive_order_line(uuid, int, text) from public, anon;
