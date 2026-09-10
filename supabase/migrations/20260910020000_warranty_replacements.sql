-- Warranty replacements: a part that failed in the field and was replaced.
--
-- Not a sale, not damage, not an adjustment. It leaves the shelf and it costs
-- us, and until now it had to be logged as one of those three, which meant
-- nobody could count failures by part or by supplier. This adds the type, the
-- link back to the install the part went in on, and three views that turn the
-- failures into a number.
--
-- The link is its own column rather than job_id. job_id on a ledger row means
-- "this row is that job's consumption": job_margin sums it into parts cost,
-- revert_job_install returns it, and the job's ledger panel lists it. A
-- warranty replacement is none of those. It is traced to the install, not
-- charged to it, so the margin recorded on the day stays what it was.
--
-- The type is marked system so its code cannot be renamed or removed from
-- Settings: the views and the form key on the word. Its wording is still
-- editable there.

-- ---------------------------------------------------------------------------
-- the type
-- ---------------------------------------------------------------------------
insert into public.transaction_types (value, label, direction, help, sort_order, is_system)
values (
  'warranty', 'Warranty replacement', -1,
  'A part that failed in the field and was replaced under warranty. Leaves '
  'the shelf at cost and is traced to the job it went in on.',
  45, true
)
on conflict (value) do nothing;

-- ---------------------------------------------------------------------------
-- the trace back to the install
-- ---------------------------------------------------------------------------
alter table public.inventory_transactions
  add column if not exists warranty_job_id uuid references public.jobs(id) on delete set null;

create index if not exists inventory_transactions_warranty_job_id_idx
  on public.inventory_transactions (warranty_job_id)
  where warranty_job_id is not null;

-- A warranty row always names its install, and nothing else may. The second
-- half keeps the column meaning one thing, so the views can trust it.
alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_warranty_job_check;

alter table public.inventory_transactions
  add constraint inventory_transactions_warranty_job_check
  check ((txn_type = 'warranty') = (warranty_job_id is not null));

-- ---------------------------------------------------------------------------
-- every replacement, with where it went in and who it was bought from
--
-- The supplier is not on the item. It is read off the supplier order that
-- brought the part in: the most recent received line for that item on or
-- before the failure, or failing that the nearest one after it, since a part
-- back loaded before orders were tracked still came from somebody. A part
-- with no order at all reads as Unknown rather than being dropped.
-- ---------------------------------------------------------------------------
create or replace view public.warranty_replacements
with (security_invoker = true) as
select
  t.id,
  t.created_at                                               as failed_at,
  t.created_at::date                                         as failed_on,
  t.item_id,
  i.sku,
  i.name                                                     as item_name,
  i.variant,
  i.category,
  (-t.quantity)::int                                         as units,
  t.unit_cost_at_txn,
  round(-t.quantity * coalesce(t.unit_cost_at_txn, 0), 2)    as cost,
  t.reference,
  t.note,
  t.location,
  t.created_by,
  t.warranty_job_id,
  j.customer_name,
  j.city,
  j.install_date,
  j.invoice_number,
  j.system_template,
  ins.name                                                   as installer_name,
  case
    when j.install_date is not null then (t.created_at::date - j.install_date)
  end                                                        as days_in_service,
  coalesce(sup.supplier, 'Unknown')                          as supplier,
  sup.order_number                                           as supplier_order_number,
  sup.order_date                                             as supplier_order_date
from public.inventory_transactions t
join public.inventory_items i on i.id = t.item_id
left join public.jobs j on j.id = t.warranty_job_id
left join public.installers ins on ins.id = j.installer_id
left join lateral (
  select so.supplier, so.order_number, so.order_date
  from public.supplier_order_lines sol
  join public.supplier_orders so on so.id = sol.order_id
  where sol.item_id = t.item_id
    and sol.quantity_received > 0
  order by
    (so.order_date > t.created_at::date),
    abs(so.order_date - t.created_at::date),
    so.created_at desc
  limit 1
) sup on true
where t.txn_type = 'warranty';

-- ---------------------------------------------------------------------------
-- by part. The rate is failures against units installed, net of installs
-- that were reversed, because a part that never went into a house cannot
-- have failed in one.
-- ---------------------------------------------------------------------------
create or replace view public.warranty_by_sku
with (security_invoker = true) as
with installed as (
  select
    item_id,
    sum(case
          when txn_type = 'install' then -quantity
          when txn_type = 'return' and source = 'template_reversal' then -quantity
          else 0
        end)::int as units_installed
  from public.inventory_transactions
  group by item_id
),
purchased as (
  select item_id, sum(quantity)::int as units_purchased
  from public.inventory_transactions
  where txn_type = 'purchase'
  group by item_id
)
select
  w.item_id,
  w.sku,
  w.item_name,
  w.variant,
  w.category,
  count(*)::int                                        as events,
  sum(w.units)::int                                    as failures,
  sum(w.cost)::numeric(12,2)                           as cost,
  min(w.failed_on)                                     as first_failed_on,
  max(w.failed_on)                                     as last_failed_on,
  coalesce(ins.units_installed, 0)                     as units_installed,
  coalesce(pur.units_purchased, 0)                     as units_purchased,
  case
    when coalesce(ins.units_installed, 0) > 0
    then round(sum(w.units) * 100.0 / ins.units_installed, 1)
  end                                                  as failure_rate_pct,
  string_agg(distinct w.supplier, ', ' order by w.supplier) as suppliers
from public.warranty_replacements w
left join installed ins on ins.item_id = w.item_id
left join purchased pur on pur.item_id = w.item_id
group by w.item_id, w.sku, w.item_name, w.variant, w.category,
         ins.units_installed, pur.units_purchased;

-- ---------------------------------------------------------------------------
-- by supplier. The rate is failures against everything received from them,
-- which is the number to put in front of a rep.
-- ---------------------------------------------------------------------------
create or replace view public.warranty_by_supplier
with (security_invoker = true) as
with received as (
  select so.supplier, sum(sol.quantity_received)::int as units_received
  from public.supplier_order_lines sol
  join public.supplier_orders so on so.id = sol.order_id
  group by so.supplier
)
select
  w.supplier,
  count(*)::int                                        as events,
  sum(w.units)::int                                    as failures,
  sum(w.cost)::numeric(12,2)                           as cost,
  count(distinct w.item_id)::int                       as skus,
  min(w.failed_on)                                     as first_failed_on,
  max(w.failed_on)                                     as last_failed_on,
  coalesce(r.units_received, 0)                        as units_received,
  case
    when coalesce(r.units_received, 0) > 0
    then round(sum(w.units) * 100.0 / r.units_received, 1)
  end                                                  as failure_rate_pct,
  string_agg(distinct w.sku, ', ' order by w.sku)      as skus_list
from public.warranty_replacements w
left join received r on r.supplier = w.supplier
group by w.supplier, r.units_received;

-- ---------------------------------------------------------------------------
-- prove it, so a broken migration cannot apply quietly
-- ---------------------------------------------------------------------------
do $$
declare
  v_item    uuid;
  v_job     uuid;
  v_refused boolean := false;
begin
  if not exists (
    select 1 from public.transaction_types
    where value = 'warranty' and direction = -1 and is_system
  ) then
    raise exception 'the warranty type did not land';
  end if;

  select id into v_item from public.inventory_items order by created_at limit 1;
  select id into v_job  from public.jobs order by created_at limit 1;

  -- a warranty row with no original job is refused
  if v_item is not null then
    begin
      insert into public.inventory_transactions (item_id, quantity, txn_type)
      values (v_item, -1, 'warranty');
      raise exception 'a warranty row with no original job was accepted';
    exception
      when check_violation then v_refused := true;
    end;

    if not v_refused then
      raise exception 'the warranty guard did not fire';
    end if;
  end if;

  -- and an ordinary row cannot borrow the trace
  if v_item is not null and v_job is not null then
    v_refused := false;
    begin
      insert into public.inventory_transactions (item_id, quantity, txn_type, warranty_job_id)
      values (v_item, -1, 'damage', v_job);
      raise exception 'a damage row with a warranty trace was accepted';
    exception
      when check_violation then v_refused := true;
    end;

    if not v_refused then
      raise exception 'the warranty guard let a damage row carry a trace';
    end if;
  end if;

  -- the views answer, empty or not
  perform 1 from public.warranty_replacements limit 1;
  perform 1 from public.warranty_by_sku limit 1;
  perform 1 from public.warranty_by_supplier limit 1;
end $$;

notify pgrst, 'reload schema';
