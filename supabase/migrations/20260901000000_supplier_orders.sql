-- Supplier orders, so a shortage becomes a date.
--
-- "We are short a mixed bed" and "short until the 14th" are different
-- sentences to whoever is booking work, and the difference is entirely a
-- purchase order nobody had anywhere to put. This adds the order, the lines,
-- and a third figure beside on hand and promised.
--
-- Two rules shape the design.
--
-- The ledger stays the single source of truth. Receiving does not set a stock
-- level; it writes a purchase transaction, exactly as a hand entry would, and
-- on hand is summed from the ledger as it always was. An order is a promise
-- about the future, and it stops being one the moment the stock is real.
--
-- Landed cost is derived, never typed. Freight and tax sit on the order, and
-- every line carries its share in proportion to what it cost. That is how
-- invoice 5831 was entered by hand: dividing those landed costs by a single
-- rate gives 450.00, 225.00, 22.50 and 787.49, which is a uniform percentage
-- uplift on unit cost, which is the same thing as allocating by extended cost.
-- Doing it in a view rather than a column means it cannot drift out of step
-- with the freight figure it came from.

-- ---------------------------------------------------------------------------
-- the order
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_orders (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  supplier        text not null,
  order_number    text,
  order_date      date not null,
  expected_arrival date,

  status          text not null default 'ordered'
                    check (status in ('ordered', 'partial', 'received', 'cancelled')),

  -- allocated across the lines, never entered per line
  freight_amount  numeric(10,2) not null default 0 check (freight_amount >= 0),
  tax_amount      numeric(10,2) not null default 0 check (tax_amount >= 0),

  -- what the invoice says at the bottom. Not used in any calculation: it is
  -- there so the entry flow can tell you when the lines add up and when you
  -- are still missing one.
  invoice_total   numeric(10,2) check (invoice_total is null or invoice_total >= 0),

  notes           text,
  received_at     timestamptz,
  created_by      uuid references auth.users(id) default auth.uid()
);

comment on table public.supplier_orders is
  'A purchase in flight. Freight and tax live here and are allocated across '
  'the lines, so landed cost is derived rather than typed.';

comment on column public.supplier_orders.invoice_total is
  'The total printed on the invoice, for reconciling data entry. Nothing is '
  'calculated from it.';

comment on column public.supplier_orders.status is
  'ordered and partial count toward incoming stock. received and cancelled '
  'do not.';

create index if not exists supplier_orders_open_idx
  on public.supplier_orders (expected_arrival)
  where status in ('ordered', 'partial');

-- ---------------------------------------------------------------------------
-- the lines
--
-- No unique constraint on (order_id, item_id). A real invoice can list the
-- same part twice at two prices, and blocking that would block entering the
-- document that actually arrived.
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_order_lines (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  order_id          uuid not null references public.supplier_orders(id) on delete cascade,
  item_id           uuid not null references public.inventory_items(id) on delete restrict,

  quantity_ordered  int not null check (quantity_ordered > 0),
  quantity_received int not null default 0 check (quantity_received >= 0),

  -- as invoiced, before freight and tax. The landed figure is derived.
  unit_cost         numeric(10,2) not null check (unit_cost >= 0),

  note              text
);

comment on column public.supplier_order_lines.unit_cost is
  'The price on the invoice line, before freight and tax. Landed cost is '
  'derived in supplier_order_lines_costed and is what receiving stamps on '
  'the ledger.';

alter table public.supplier_order_lines
  drop constraint if exists supplier_order_lines_not_over_received;

alter table public.supplier_order_lines
  add constraint supplier_order_lines_not_over_received
  check (quantity_received <= quantity_ordered);

create index if not exists supplier_order_lines_order_idx
  on public.supplier_order_lines (order_id);

create index if not exists supplier_order_lines_item_idx
  on public.supplier_order_lines (item_id);

-- ---------------------------------------------------------------------------
-- housekeeping
-- ---------------------------------------------------------------------------
create or replace function public.supplier_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists supplier_orders_touch on public.supplier_orders;
create trigger supplier_orders_touch before update on public.supplier_orders
  for each row execute function public.supplier_touch();

drop trigger if exists supplier_order_lines_touch on public.supplier_order_lines;
create trigger supplier_order_lines_touch before update on public.supplier_order_lines
  for each row execute function public.supplier_touch();

-- ---------------------------------------------------------------------------
-- row level security, matching every other table here
-- ---------------------------------------------------------------------------
alter table public.supplier_orders enable row level security;
alter table public.supplier_order_lines enable row level security;

do $$
declare
  t text;
  c text;
begin
  foreach t in array array['supplier_orders', 'supplier_order_lines'] loop
    foreach c in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_' || c, t);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) is not null)',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) is not null)',
      t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) is not null)',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) is not null)',
      t || '_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- landed cost
--
-- Each line carries freight and tax in proportion to what it cost, which is
-- the same as adding one percentage to every unit price. Allocation uses the
-- quantity ordered rather than the quantity received on purpose: the invoice
-- charged freight on the whole shipment, so a part delivery must not change
-- what a unit costs.
-- ---------------------------------------------------------------------------
create or replace view public.supplier_order_lines_costed
with (security_invoker = true) as
with totals as (
  select order_id, sum(quantity_ordered * unit_cost) as subtotal
  from public.supplier_order_lines
  group by order_id
)
select
  l.id,
  l.order_id,
  l.item_id,
  l.quantity_ordered,
  l.quantity_received,
  greatest(l.quantity_ordered - l.quantity_received, 0) as quantity_outstanding,
  l.unit_cost,
  l.note,
  l.created_at,

  i.sku,
  i.name        as item_name,
  i.variant,
  i.category,
  i.unit_cost   as catalog_unit_cost,

  o.supplier,
  o.order_number,
  o.order_date,
  o.expected_arrival,
  o.status      as order_status,
  o.freight_amount,
  o.tax_amount,

  (l.quantity_ordered * l.unit_cost)::numeric(12,2) as extended_cost,
  coalesce(t.subtotal, 0)::numeric(12,2)            as order_subtotal,

  -- what this line carries of the freight and tax, in money
  case
    when coalesce(t.subtotal, 0) = 0 then 0::numeric(12,2)
    else round((o.freight_amount + o.tax_amount)
               * (l.quantity_ordered * l.unit_cost) / t.subtotal, 2)
  end as allocated_extra,

  -- Two decimals, because that is what the ledger already holds and what the
  -- hand entry of 5831 produced. The rounding error across a whole order is
  -- pennies and is reported rather than hidden.
  case
    when coalesce(t.subtotal, 0) = 0 then l.unit_cost
    else round(l.unit_cost * (1 + (o.freight_amount + o.tax_amount) / t.subtotal), 2)
  end as landed_unit_cost
from public.supplier_order_lines l
join public.supplier_orders o on o.id = l.order_id
join public.inventory_items i on i.id = l.item_id
left join totals t on t.order_id = l.order_id;

comment on view public.supplier_order_lines_costed is
  'Order lines with freight and tax spread across them by extended cost. '
  'Landed unit cost is what receiving stamps on the ledger.';

grant select on public.supplier_order_lines_costed to authenticated;

-- ---------------------------------------------------------------------------
-- the order, summarised
-- ---------------------------------------------------------------------------
create or replace view public.supplier_order_summary
with (security_invoker = true) as
select
  o.id,
  o.created_at,
  o.supplier,
  o.order_number,
  o.order_date,
  o.expected_arrival,
  o.status,
  o.freight_amount,
  o.tax_amount,
  o.invoice_total,
  o.notes,
  o.received_at,

  coalesce(c.line_count, 0)::int          as line_count,
  coalesce(c.units_ordered, 0)::int       as units_ordered,
  coalesce(c.units_received, 0)::int      as units_received,
  coalesce(c.units_outstanding, 0)::int   as units_outstanding,
  coalesce(c.subtotal, 0)::numeric(12,2)  as subtotal,
  (coalesce(c.subtotal, 0) + o.freight_amount + o.tax_amount)::numeric(12,2) as order_total,

  -- Zero means the lines entered account for the whole invoice. Anything else
  -- is a line still to be typed, or a typo. Null when no invoice total was
  -- recorded, because then there is nothing to reconcile against.
  case
    when o.invoice_total is null then null
    else (o.invoice_total - (coalesce(c.subtotal, 0) + o.freight_amount + o.tax_amount))::numeric(12,2)
  end as entry_balance
from public.supplier_orders o
left join (
  select
    order_id,
    count(*)                                                as line_count,
    sum(quantity_ordered)                                   as units_ordered,
    sum(quantity_received)                                  as units_received,
    sum(greatest(quantity_ordered - quantity_received, 0))  as units_outstanding,
    sum(quantity_ordered * unit_cost)                       as subtotal
  from public.supplier_order_lines
  group by order_id
) c on c.order_id = o.id;

comment on view public.supplier_order_summary is
  'One row per order, with the totals the list needs and an entry balance '
  'that reads zero when the lines add up to the invoice.';

grant select on public.supplier_order_summary to authenticated;

-- ---------------------------------------------------------------------------
-- on order, beside on hand and promised
--
-- Only orders still in flight count. A received order has become stock and is
-- already in on hand; a cancelled one is never arriving. The earliest date
-- among the outstanding lines is the one worth showing, because that is when
-- the shortage ends.
-- ---------------------------------------------------------------------------
create or replace view public.inventory_stock
with (security_invoker = true) as
select
  i.id,
  i.created_at,
  i.sku,
  i.name,
  i.category,
  i.variant,
  i.unit_cost,
  i.reorder_threshold,
  i.active,
  i.notes,
  coalesce(t.on_hand, 0)::int as on_hand,
  round(coalesce(t.on_hand, 0)::numeric * i.unit_cost, 2) as stock_value,
  coalesce(r.committed, 0)::int as committed,
  (coalesce(t.on_hand, 0) - coalesce(r.committed, 0))::int as available,
  coalesce(o.on_order, 0)::int as on_order,
  o.expected_arrival
from public.inventory_items i
left join (
  select tx.item_id, sum(tx.quantity) as on_hand
  from public.inventory_transactions tx
  group by tx.item_id
) t on t.item_id = i.id
left join (
  select jr.item_id, sum(jr.quantity) as committed
  from public.job_reservations jr
  where jr.released_at is null
  group by jr.item_id
) r on r.item_id = i.id
left join (
  select
    l.item_id,
    sum(greatest(l.quantity_ordered - l.quantity_received, 0)) as on_order,
    min(so.expected_arrival) filter (
      where l.quantity_ordered > l.quantity_received
    ) as expected_arrival
  from public.supplier_order_lines l
  join public.supplier_orders so on so.id = l.order_id
  where so.status in ('ordered', 'partial')
    and l.quantity_ordered > l.quantity_received
  group by l.item_id
) o on o.item_id = i.id;

comment on view public.inventory_stock is
  'On hand from the ledger, promised from the reservations, on order from the '
  'open purchase orders, with the earliest date any of it is expected.';

-- ---------------------------------------------------------------------------
-- keeping the order status honest
--
-- Recomputed from the lines rather than set by whoever happened to touch it
-- last, so an edited quantity cannot leave an order claiming to be received
-- when it is not. Cancelled is a decision a person made and is left alone.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_order_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_lines      int;
  v_outstanding int;
  v_received   int;
  v_current    text;
  v_next       text;
begin
  select status into v_current from public.supplier_orders where id = p_order_id;

  if not found then return null; end if;
  if v_current = 'cancelled' then return v_current; end if;

  select
    count(*),
    coalesce(sum(greatest(quantity_ordered - quantity_received, 0)), 0),
    coalesce(sum(quantity_received), 0)
  into v_lines, v_outstanding, v_received
  from public.supplier_order_lines
  where order_id = p_order_id;

  -- An order with no lines yet is still just ordered. Calling it received
  -- because nothing is outstanding would be true and useless.
  if v_lines = 0 then
    v_next := 'ordered';
  elsif v_outstanding = 0 then
    v_next := 'received';
  elsif v_received > 0 then
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
$fn$;

create or replace function public.supplier_order_lines_sync_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.recompute_order_status(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end;
$fn$;

drop trigger if exists supplier_order_lines_status on public.supplier_order_lines;
create trigger supplier_order_lines_status
  after insert or update or delete on public.supplier_order_lines
  for each row execute function public.supplier_order_lines_sync_status();

-- ---------------------------------------------------------------------------
-- telling the stock channel an order landed
--
-- Through the notify function, which is the only thing that talks to Slack.
-- Wrapped, because a purchase that physically arrived must not fail to be
-- recorded just because Slack is unreachable or a secret is missing. The
-- receipt is the important part; the message is a courtesy.
-- ---------------------------------------------------------------------------
create or replace function public.supplier_orders_announce_arrival()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if new.status = 'received' and old.status is distinct from 'received' then
    begin
      perform public.trigger_notify(jsonb_build_object(
        'mode', 'order',
        'event', 'received',
        'order_id', new.id
      ));
    exception when others then
      raise warning 'order % arrived but Slack was not told: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$fn$;

drop trigger if exists supplier_orders_arrival on public.supplier_orders;
create trigger supplier_orders_arrival
  after update on public.supplier_orders
  for each row execute function public.supplier_orders_announce_arrival();

-- ---------------------------------------------------------------------------
-- receiving
--
-- Partial by default. A line can be received across as many deliveries as it
-- takes, and each one writes its own purchase transaction, so the ledger reads
-- as what actually turned up on which day rather than as one tidy fiction.
-- ---------------------------------------------------------------------------
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

  -- the trigger on this update recomputes the order status, which in turn
  -- fires the arrival message when the last line lands
  update public.supplier_order_lines
  set quantity_received = quantity_received + p_quantity
  where id = p_line_id;

  return jsonb_build_object(
    'transaction_id',   v_txn_id,
    'item_id',          v_line.item_id,
    'sku',              v_line.sku,
    'quantity',         p_quantity,
    'landed_unit_cost', v_line.landed_unit_cost,
    'landed_value',     round(v_line.landed_unit_cost * p_quantity, 2),
    'still_outstanding', v_line.quantity_outstanding - p_quantity,
    'order_status',     (select status from public.supplier_orders where id = v_line.order_id)
  );
end;
$fn$;

comment on function public.receive_order_line(uuid, int, text) is
  'Receives part or all of one order line. Writes a purchase transaction at '
  'the landed cost, so stock and the ledger stay the single source of truth.';

grant execute on function public.receive_order_line(uuid, int, text) to authenticated;
revoke execute on function public.receive_order_line(uuid, int, text) from anon;

-- ---------------------------------------------------------------------------
-- QB-20104, the Honest invoice
--
-- Header only. The lines are entered through the app, which is the flow this
-- migration exists to support, and typing them here would prove nothing about
-- whether that flow works.
--
-- No expected arrival, because nobody has told me one. A guessed date is
-- worse than a blank, since the whole point of the feature is that the date
-- can be trusted.
-- ---------------------------------------------------------------------------
insert into public.supplier_orders
  (supplier, order_number, order_date, status, freight_amount, tax_amount, invoice_total, notes)
select
  'Honest', 'QB-20104', date '2026-08-17', 'ordered', 758.05, 0, 10561.05,
  'Loaded from the Honest invoice. Lines still to be entered: the balance '
  'reads zero once they add up to 9,803.00 before freight.'
where not exists (
  select 1 from public.supplier_orders where order_number = 'QB-20104'
);

notify pgrst, 'reload schema';
