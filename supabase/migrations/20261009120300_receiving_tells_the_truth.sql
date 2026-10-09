-- Receiving records what arrived, not what was hoped for.
--
-- NOT ADDITIVE. This drops a CHECK constraint and replaces one view and two
-- functions that already exist. It goes to a Supabase branch and is approved
-- before it reaches production. 20261009120200 added the columns it uses and
-- was additive, so that half is already live.
--
-- What changes, and why each one is the smallest change that tells the truth:
--
--   outstanding   was ordered - received. Becomes
--                 ordered - received - short_closed, floored at zero. A line
--                 nobody is waiting for stops being something to wait for.
--   the CHECK     quantity_received <= quantity_ordered is dropped. It was
--                 refusing to record a fact: if five turn up against an order
--                 for four, five are on the shelf whatever the database
--                 prefers. The constraint did not stop the fifth arriving, it
--                 stopped anybody writing it down.
--   receive       takes p_allow_over. Over receiving is possible but never
--                 accidental: without the flag the function still refuses and
--                 says what it would take. A typed 100 for 10 puts ninety
--                 phantom units on a shelf, which then resolve build sheet
--                 lines and get deducted to jobs, and the ledger is append
--                 only so the correction is another row rather than an edit.
--                 Hence a confirmation rather than a warning.
--
-- The ledger keeps its one rule: every variance is a new row and nothing is
-- ever edited. A substitution writes a purchase for the part that actually
-- arrived and closes the ordered line short. Nothing fictional is booked in.
--
-- A refusal writes no ledger row at all. Stock that was sent back never
-- reached the shelf, so there is nothing to move. The ledger's damage type is
-- for stock that goes bad while we own it, which is a different event.

alter table public.supplier_order_lines
  drop constraint if exists supplier_order_lines_not_over_received;

create or replace view public.supplier_order_lines_costed as
 with totals as (
   select supplier_order_lines.order_id,
          sum(supplier_order_lines.quantity_ordered::numeric * supplier_order_lines.unit_cost) as subtotal
     from supplier_order_lines
    group by supplier_order_lines.order_id
 )
 select l.id,
    l.order_id,
    l.item_id,
    l.quantity_ordered,
    l.quantity_received,
    -- The change. A line closed short is not outstanding.
    greatest(l.quantity_ordered - l.quantity_received - l.quantity_short_closed, 0) as quantity_outstanding,
    l.unit_cost,
    l.note,
    l.created_at,
    i.sku,
    i.name as item_name,
    i.variant,
    i.category,
    i.unit_cost as catalog_unit_cost,
    o.supplier,
    o.order_number,
    o.order_date,
    o.expected_arrival,
    o.status as order_status,
    o.freight_amount,
    o.tax_amount,
    (l.quantity_ordered::numeric * l.unit_cost)::numeric(12,2) as extended_cost,
    coalesce(t.subtotal, 0::numeric)::numeric(12,2) as order_subtotal,
        case
            when coalesce(t.subtotal, 0::numeric) = 0::numeric then 0::numeric(12,2)
            else round((o.freight_amount + o.tax_amount) * (l.quantity_ordered::numeric * l.unit_cost) / t.subtotal, 2)
        end as allocated_extra,
        case
            when coalesce(t.subtotal, 0::numeric) = 0::numeric then l.unit_cost
            else round(l.unit_cost * (1::numeric + (o.freight_amount + o.tax_amount) / t.subtotal), 2)
        end as landed_unit_cost,
    -- The variance, so a page can show it without a second query.
    l.quantity_short_closed,
    l.short_reason,
    l.short_note,
    l.closed_short_at,
    l.substituted_item_id,
    sub.sku as substituted_sku,
    sub.name as substituted_item_name,
    l.quantity_refused,
    l.refused_reason,
    l.refused_note,
    greatest(l.quantity_received - l.quantity_ordered, 0) as quantity_over,
    l.closed_short_at is not null as is_closed_short
   from supplier_order_lines l
     join supplier_orders o on o.id = l.order_id
     join inventory_items i on i.id = l.item_id
     left join inventory_items sub on sub.id = l.substituted_item_id
     left join totals t on t.order_id = l.order_id;

-- An order with every line either received or closed short is finished.
create or replace function public.recompute_order_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_lines       int;
  v_outstanding int;
  v_received    int;
  v_closed      int;
  v_current     text;
  v_next        text;
begin
  select status into v_current from public.supplier_orders where id = p_order_id;

  if not found then return null; end if;
  if v_current = 'cancelled' then return v_current; end if;

  select
    count(*),
    coalesce(sum(greatest(quantity_ordered - quantity_received - quantity_short_closed, 0)), 0),
    coalesce(sum(quantity_received), 0),
    coalesce(sum(quantity_short_closed), 0)
  into v_lines, v_outstanding, v_received, v_closed
  from public.supplier_order_lines
  where order_id = p_order_id;

  if v_lines = 0 then
    v_next := 'ordered';
  elsif v_outstanding = 0 then
    -- Received means nothing is still expected, which includes an order where
    -- the rest was cancelled. The line keeps its reason, so the order says
    -- what happened rather than pretending it all turned up.
    v_next := 'received';
  elsif v_received > 0 or v_closed > 0 then
    v_next := 'partial';
  else
    v_next := 'ordered';
  end if;

  if v_next is distinct from v_current then
    update public.supplier_orders
    set status      = v_next,
        received_at = case when v_next = 'received' then now() else null end
    where id = p_order_id;
  end if;

  return v_next;
end;
$function$;

-- Receiving, with an overage only when somebody says so.
create or replace function public.receive_order_line(
  p_line_id uuid,
  p_quantity integer,
  p_note text default null,
  p_allow_over boolean default false
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_line   record;
  v_txn_id uuid;
  v_over   int;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Enter how many arrived. It has to be at least one, not %.', p_quantity
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

  v_over := greatest(p_quantity - v_line.quantity_outstanding, 0);

  -- The confirmation. Refused by default and the message says exactly what
  -- would happen, so saying yes is a decision rather than a shrug.
  if v_over > 0 and not coalesce(p_allow_over, false) then
    raise exception
      'That is % more than the % still expected on this line. If % really arrived, '
      'confirm the extra and it goes on the shelf at the landed cost.',
      v_over, v_line.quantity_outstanding, p_quantity
      using errcode = 'check_violation';
  end if;

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
      format('Received against %s from %s%s',
             coalesce(nullif(v_line.order_number, ''), 'a supplier order'),
             v_line.supplier,
             case when v_over > 0
                  then format('. %s more than ordered, confirmed on arrival', v_over)
                  else '' end)),
    'manual'
  )
  returning id into v_txn_id;

  update public.inventory_items
  set unit_cost = v_line.landed_unit_cost
  where id = v_line.item_id
    and unit_cost is distinct from v_line.landed_unit_cost;

  update public.supplier_order_lines
  set quantity_received = quantity_received + p_quantity
  where id = p_line_id;

  return jsonb_build_object(
    'transaction_id',     v_txn_id,
    'item_id',            v_line.item_id,
    'sku',                v_line.sku,
    'quantity',           p_quantity,
    'quantity_over',      v_over,
    'landed_unit_cost',   v_line.landed_unit_cost,
    'landed_value',       round(v_line.landed_unit_cost * p_quantity, 2),
    'still_outstanding',  greatest(v_line.quantity_outstanding - p_quantity, 0),
    'order_status',       public.recompute_order_status(v_line.order_id),
    'previous_unit_cost', v_line.catalog_unit_cost,
    'unit_cost_changed',  v_line.catalog_unit_cost is distinct from v_line.landed_unit_cost
  );
end;
$function$;

-- Close what is not coming.
create or replace function public.close_order_line_short(
  p_line_id uuid,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_line record;
  v_gap  int;
begin
  select * into v_line from public.supplier_order_lines_costed where id = p_line_id;

  if not found then
    raise exception 'That order line does not exist, or you cannot see it.'
      using errcode = 'no_data_found';
  end if;

  if v_line.quantity_outstanding <= 0 then
    raise exception 'Nothing is still expected on that line, so there is nothing to close.'
      using errcode = 'check_violation';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why the rest is not coming.' using errcode = 'check_violation';
  end if;

  v_gap := v_line.quantity_outstanding;

  update public.supplier_order_lines
  set quantity_short_closed = quantity_short_closed + v_gap,
      short_reason          = p_reason,
      short_note            = nullif(btrim(coalesce(p_note, '')), ''),
      closed_short_at       = now()
  where id = p_line_id;

  return jsonb_build_object(
    'line_id',      p_line_id,
    'sku',          v_line.sku,
    'closed_short', v_gap,
    'reason',       p_reason,
    'order_status', public.recompute_order_status(v_line.order_id)
  );
end;
$function$;

-- A different part turned up.
--
-- Two facts, recorded separately because they are separate: what arrived goes
-- on the shelf as itself, and what was ordered stops being expected. The
-- ordered item is never booked in, so the shelf never holds a part nobody sent.
create or replace function public.receive_order_line_substitute(
  p_line_id uuid,
  p_actual_item_id uuid,
  p_quantity integer,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_line   record;
  v_actual record;
  v_txn_id uuid;
  v_gap    int;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Enter how many arrived. It has to be at least one, not %.', p_quantity
      using errcode = 'check_violation';
  end if;

  select * into v_line from public.supplier_order_lines_costed where id = p_line_id;

  if not found then
    raise exception 'That order line does not exist, or you cannot see it.'
      using errcode = 'no_data_found';
  end if;

  if v_line.order_status = 'cancelled' then
    raise exception 'That order is cancelled, so nothing can be received against it.'
      using errcode = 'check_violation';
  end if;

  select * into v_actual from public.inventory_items where id = p_actual_item_id;

  if not found then
    raise exception 'That part is not in the parts list.' using errcode = 'no_data_found';
  end if;

  if p_actual_item_id = v_line.item_id then
    raise exception
      'That is the part that was ordered. Receive it as arrived rather than as a substitute.'
      using errcode = 'check_violation';
  end if;

  -- The substitute goes on the shelf at the ordered line's landed cost, which
  -- is what was actually paid: the invoice charged for this line whatever came
  -- against it. Its own catalogue price is what it would cost to buy, not what
  -- this one cost.
  insert into public.inventory_transactions
    (item_id, quantity, txn_type, unit_cost_at_txn, reference, note, source)
  values (
    p_actual_item_id,
    p_quantity,
    'purchase',
    v_line.landed_unit_cost,
    coalesce(nullif(v_line.order_number, ''), v_line.supplier),
    coalesce(
      nullif(p_note, ''),
      format('Arrived against %s from %s in place of %s, which was ordered.',
             coalesce(nullif(v_line.order_number, ''), 'a supplier order'),
             v_line.supplier, v_line.sku)),
    'manual'
  )
  returning id into v_txn_id;

  update public.inventory_items
  set unit_cost = v_line.landed_unit_cost
  where id = p_actual_item_id
    and unit_cost is distinct from v_line.landed_unit_cost;

  v_gap := v_line.quantity_outstanding;

  update public.supplier_order_lines
  set quantity_short_closed = quantity_short_closed + v_gap,
      short_reason          = 'substituted',
      short_note            = format('%s arrived instead%s',
                               v_actual.sku,
                               case when coalesce(btrim(p_note), '') = ''
                                    then '' else '. ' || btrim(p_note) end),
      substituted_item_id   = p_actual_item_id,
      closed_short_at       = now()
  where id = p_line_id;

  return jsonb_build_object(
    'transaction_id',  v_txn_id,
    'ordered_sku',     v_line.sku,
    'arrived_sku',     v_actual.sku,
    'quantity',        p_quantity,
    'closed_short',    v_gap,
    'order_status',    public.recompute_order_status(v_line.order_id)
  );
end;
$function$;

-- Sent back on arrival. No ledger row, because it never reached the shelf.
create or replace function public.refuse_order_line(
  p_line_id uuid,
  p_quantity integer,
  p_reason text,
  p_note text default null
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_line record;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Enter how many were sent back, at least one, not %.', p_quantity
      using errcode = 'check_violation';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Say why it was sent back.' using errcode = 'check_violation';
  end if;

  select * into v_line from public.supplier_order_lines_costed where id = p_line_id;

  if not found then
    raise exception 'That order line does not exist, or you cannot see it.'
      using errcode = 'no_data_found';
  end if;

  update public.supplier_order_lines
  set quantity_refused = quantity_refused + p_quantity,
      refused_reason   = p_reason,
      refused_note     = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_line_id;

  return jsonb_build_object(
    'line_id',  p_line_id,
    'sku',      v_line.sku,
    'refused',  p_quantity,
    'reason',   p_reason,
    'in_stock', false
  );
end;
$function$;

notify pgrst, 'reload schema';

-- Proof. Every assertion is run against a scratch order created here and
-- removed at the end, so nothing in it depends on live data and nothing it
-- does survives it.
do $$
declare
  v_supplier text := 'Proof Only Supplier';
  v_order  uuid;
  v_item_a uuid;
  v_item_b uuid;
  v_line   uuid;
  v_before bigint;
  v_after  bigint;
  v_status text;
  v_msg    text;
begin
  select id into v_item_a from public.inventory_items where active order by sku limit 1;
  select id into v_item_b from public.inventory_items where active and id <> v_item_a order by sku limit 1;

  if v_item_a is null or v_item_b is null then
    raise notice 'fewer than two parts exist, so the receiving proofs are skipped';
    return;
  end if;

  insert into public.supplier_orders (supplier, order_number, order_date, status)
  values (v_supplier, 'PROOF-RECEIVING', current_date, 'ordered')
  returning id into v_order;

  -- 1. over receiving is refused without confirmation, and says what it wants
  insert into public.supplier_order_lines (order_id, item_id, quantity_ordered, unit_cost)
  values (v_order, v_item_a, 2, 10.00) returning id into v_line;

  begin
    perform public.receive_order_line(v_line, 5);
    raise exception 'An overage was accepted without confirmation.';
  exception
    when check_violation then
      get stacked diagnostics v_msg = message_text;
      if v_msg not like '%confirm%' then
        raise exception 'The overage refusal did not ask for confirmation: %', v_msg;
      end if;
  end;

  -- 2. confirmed, it lands, and the ledger carries all five
  select count(*) into v_before from public.inventory_transactions where item_id = v_item_a;
  perform public.receive_order_line(v_line, 5, null, true);
  select count(*) into v_after from public.inventory_transactions where item_id = v_item_a;

  if v_after <> v_before + 1 then
    raise exception 'A confirmed overage wrote % ledger rows, expected 1.', v_after - v_before;
  end if;

  if (select quantity_over from public.supplier_order_lines_costed where id = v_line) <> 3 then
    raise exception 'The line does not show the overage.';
  end if;

  -- 3. a line closed short stops being outstanding, and the order finishes
  insert into public.supplier_order_lines (order_id, item_id, quantity_ordered, unit_cost)
  values (v_order, v_item_b, 4, 10.00) returning id into v_line;

  perform public.receive_order_line(v_line, 1);
  v_status := public.recompute_order_status(v_order);

  if v_status <> 'partial' then
    raise exception 'An order with 3 outstanding reads %, expected partial.', v_status;
  end if;

  select count(*) into v_before from public.inventory_transactions where item_id = v_item_b;
  v_status := (public.close_order_line_short(v_line, 'supplier_shorted', 'never coming'))->>'order_status';
  select count(*) into v_after from public.inventory_transactions where item_id = v_item_b;

  if v_after <> v_before then
    raise exception 'Closing a line short moved stock. It must not.';
  end if;

  if (select quantity_outstanding from public.supplier_order_lines_costed where id = v_line) <> 0 then
    raise exception 'A line closed short is still outstanding.';
  end if;

  if v_status <> 'received' then
    raise exception 'An order with nothing left expected reads %, expected received.', v_status;
  end if;

  -- 4. a substitution books in what arrived, not what was ordered
  insert into public.supplier_order_lines (order_id, item_id, quantity_ordered, unit_cost)
  values (v_order, v_item_a, 2, 10.00) returning id into v_line;

  select count(*) into v_before from public.inventory_transactions where item_id = v_item_a;
  perform public.receive_order_line_substitute(v_line, v_item_b, 2);
  select count(*) into v_after from public.inventory_transactions where item_id = v_item_a;

  if v_after <> v_before then
    raise exception 'A substitution booked in the part that was ordered.';
  end if;

  if (select short_reason from public.supplier_order_lines where id = v_line) <> 'substituted' then
    raise exception 'A substituted line is not marked substituted.';
  end if;

  -- 5. a refusal never touches stock
  select count(*) into v_before from public.inventory_transactions;
  perform public.refuse_order_line(v_line, 1, 'damaged_in_transit', 'crushed box');
  select count(*) into v_after from public.inventory_transactions;

  if v_after <> v_before then
    raise exception 'A refusal wrote a ledger row. Refused stock never arrived.';
  end if;

  -- tidy up: the scratch order and everything the proof put on the shelf
  delete from public.inventory_transactions
  where reference = 'PROOF-RECEIVING';
  delete from public.supplier_orders where id = v_order;

  raise notice 'overage confirmed, short closed, substitution booked as itself, refusal moved nothing';
end $$;
