-- The same rule on the warranty views.
--
-- 20260926020000 stopped a missing part cost being counted as zero everywhere
-- a job is costed. The warranty pages cost the same ledger rows through their
-- own views, and those still read an unstamped row as a replacement that cost
-- nothing, which is exactly the figure a supplier argument would be built on.
--
-- warranty_replacements.cost becomes null when the ledger row carries no
-- stamped cost. The two rollups keep summing what they know, because one
-- unstamped row should not blank a supplier's whole history, and each gains a
-- count of the events behind that caveat.

create or replace view public.warranty_replacements
with (security_invoker = true) as
select
  t.id,
  t.created_at as failed_at,
  t.created_at::date as failed_on,
  t.item_id,
  i.sku,
  i.name as item_name,
  i.variant,
  i.category,
  - t.quantity as units,
  t.unit_cost_at_txn,
  round((- t.quantity)::numeric * t.unit_cost_at_txn, 2) as cost,
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
  ins.name as installer_name,
  case
    when j.install_date is not null then t.created_at::date - j.install_date
    else null::integer
  end as days_in_service,
  coalesce(sup.supplier, 'Unknown') as supplier,
  sup.order_number as supplier_order_number,
  sup.order_date as supplier_order_date
from public.inventory_transactions t
  join public.inventory_items i on i.id = t.item_id
  left join public.jobs j on j.id = t.warranty_job_id
  left join public.installers ins on ins.id = j.installer_id
  left join lateral (
    select so.supplier, so.order_number, so.order_date
    from public.supplier_order_lines sol
      join public.supplier_orders so on so.id = sol.order_id
    where sol.item_id = t.item_id and sol.quantity_received > 0
    order by (so.order_date > t.created_at::date), (abs(so.order_date - t.created_at::date)), so.created_at desc
    limit 1
  ) sup on true
where t.txn_type = 'warranty';

create or replace view public.warranty_by_sku
with (security_invoker = true) as
with installed as (
  select
    inventory_transactions.item_id,
    sum(
      case
        when inventory_transactions.txn_type = 'install' then - inventory_transactions.quantity
        when inventory_transactions.txn_type = 'return' and inventory_transactions.source = 'template_reversal' then - inventory_transactions.quantity
        else 0
      end)::integer as units_installed
  from public.inventory_transactions
  group by inventory_transactions.item_id
),
purchased as (
  select
    inventory_transactions.item_id,
    sum(inventory_transactions.quantity)::integer as units_purchased
  from public.inventory_transactions
  where inventory_transactions.txn_type = 'purchase'
  group by inventory_transactions.item_id
)
select
  w.item_id,
  w.sku,
  w.item_name,
  w.variant,
  w.category,
  count(*)::integer as events,
  sum(w.units)::integer as failures,
  sum(w.cost)::numeric(12,2) as cost,
  min(w.failed_on) as first_failed_on,
  max(w.failed_on) as last_failed_on,
  coalesce(ins.units_installed, 0) as units_installed,
  coalesce(pur.units_purchased, 0) as units_purchased,
  case
    when coalesce(ins.units_installed, 0) > 0 then round(sum(w.units)::numeric * 100.0 / ins.units_installed::numeric, 1)
    else null::numeric
  end as failure_rate_pct,
  string_agg(distinct w.supplier, ', ' order by w.supplier) as suppliers,
  count(*) filter (where w.cost is null)::integer as uncosted_events
from public.warranty_replacements w
  left join installed ins on ins.item_id = w.item_id
  left join purchased pur on pur.item_id = w.item_id
group by w.item_id, w.sku, w.item_name, w.variant, w.category, ins.units_installed, pur.units_purchased;

create or replace view public.warranty_by_supplier
with (security_invoker = true) as
with received as (
  select so.supplier, sum(sol.quantity_received)::integer as units_received
  from public.supplier_order_lines sol
    join public.supplier_orders so on so.id = sol.order_id
  group by so.supplier
)
select
  w.supplier,
  count(*)::integer as events,
  sum(w.units)::integer as failures,
  sum(w.cost)::numeric(12,2) as cost,
  count(distinct w.item_id)::integer as skus,
  min(w.failed_on) as first_failed_on,
  max(w.failed_on) as last_failed_on,
  coalesce(r.units_received, 0) as units_received,
  case
    when coalesce(r.units_received, 0) > 0 then round(sum(w.units)::numeric * 100.0 / r.units_received::numeric, 1)
    else null::numeric
  end as failure_rate_pct,
  string_agg(distinct w.sku, ', ' order by w.sku) as skus_list,
  count(*) filter (where w.cost is null)::integer as uncosted_events
from public.warranty_replacements w
  left join received r on r.supplier = w.supplier
group by w.supplier, r.units_received;

do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from public.warranty_replacements
  where unit_cost_at_txn is null and cost is not null;
  if v_bad > 0 then
    raise exception '% warranty rows still cost an unstamped replacement', v_bad;
  end if;
end $$;

notify pgrst, 'reload schema';
