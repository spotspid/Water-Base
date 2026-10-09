-- Suppliers, and what each one calls a part.
--
-- supplier_orders.supplier is free text today, so "Honest" and "honest" and
-- "Honest Water" are three suppliers, and nothing holds a supplier's own code
-- for a part. One dealer buying from two suppliers has to know in their head
-- that two codes mean one shelf item. At a hundred dealers that knowledge does
-- not exist, and the shelf goes wrong.
--
-- Which cost wins where. Three places, three jobs, no overlap. Written down
-- here so nobody re-decides it later, because the same question answered two
-- ways is already one of the most expensive faults on the known issues list:
--
--   1. The ledger row's stamped cost is truth. inventory_transactions
--      .unit_cost_at_txn never changes. It is why a job that installed in
--      August still reports the margin it had in August, and it is the single
--      decision the whole system rests on.
--   2. The catalog price is a quoting aid. It prefills a new order line and
--      is the cost of nothing already bought.
--   3. The item's cost follows the last receipt. inventory_items.unit_cost is
--      set to what was actually paid when stock arrives, and unbuilt jobs read
--      their expected costs from it.

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  phone       text,
  email       text,
  notes       text,
  active      boolean not null default true,
  constraint suppliers_name_not_blank check (btrim(name) <> '')
);

-- Case insensitive, because "Honest" and "honest" being two suppliers is the
-- fault this table exists to end.
create unique index if not exists suppliers_name_key
  on public.suppliers (lower(btrim(name)));

comment on table public.suppliers is
  'Who stock is bought from. Replaces the free text name on supplier_orders.';

-- What a supplier calls a part, and what they charge for it.
create table if not exists public.supplier_catalog (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  supplier_id       uuid not null references public.suppliers (id) on delete cascade,
  item_id           uuid not null references public.inventory_items (id) on delete restrict,
  supplier_sku      text,
  unit_price        numeric(10,2),
  price_updated_at  timestamptz,
  notes             text,
  -- Whether this row came from the shipped preset. A user row is never
  -- touched by an update; see supplier_catalog_apply_preset.
  is_preset         boolean not null default false,
  constraint supplier_catalog_price_sane check (unit_price is null or unit_price >= 0)
);

create unique index if not exists supplier_catalog_supplier_item_key
  on public.supplier_catalog (supplier_id, item_id);

comment on table public.supplier_catalog is
  'Per supplier price book. A quoting aid that prefills an order line, never '
  'the cost of anything already bought: that is stamped on the ledger row.';

-- A preset row the user deleted stays deleted.
--
-- Insert when absent, on its own, resurrects it on the next update, which
-- reads to the user as the app overruling them. This remembers the deletion
-- so the seed can skip it for good.
create table if not exists public.supplier_catalog_removed (
  supplier_id  uuid not null references public.suppliers (id) on delete cascade,
  item_id      uuid not null references public.inventory_items (id) on delete cascade,
  removed_at   timestamptz not null default now(),
  primary key (supplier_id, item_id)
);

comment on table public.supplier_catalog_removed is
  'Preset catalog rows the user deleted. The seed skips these for good, so an '
  'update cannot bring back a row somebody deliberately removed.';

-- Link orders to the real supplier.
--
-- The column only. Filling it in, and keeping supplier_orders.supplier in step
-- with it, writes to rows that already exist, so that half is a separate
-- migration and is proved on a branch before it reaches production here.
alter table public.supplier_orders
  add column if not exists supplier_id uuid references public.suppliers (id);

-- Access, the same flat model as every other table here.
alter table public.suppliers enable row level security;
alter table public.supplier_catalog enable row level security;
alter table public.supplier_catalog_removed enable row level security;

drop policy if exists suppliers_select on public.suppliers;
drop policy if exists suppliers_insert on public.suppliers;
drop policy if exists suppliers_update on public.suppliers;
drop policy if exists suppliers_delete on public.suppliers;

create policy suppliers_select on public.suppliers
  for select to authenticated using ((select auth.uid()) is not null);
create policy suppliers_insert on public.suppliers
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy suppliers_update on public.suppliers
  for update to authenticated using ((select auth.uid()) is not null);
create policy suppliers_delete on public.suppliers
  for delete to authenticated using ((select auth.uid()) is not null);

drop policy if exists supplier_catalog_select on public.supplier_catalog;
drop policy if exists supplier_catalog_insert on public.supplier_catalog;
drop policy if exists supplier_catalog_update on public.supplier_catalog;
drop policy if exists supplier_catalog_delete on public.supplier_catalog;

create policy supplier_catalog_select on public.supplier_catalog
  for select to authenticated using ((select auth.uid()) is not null);
create policy supplier_catalog_insert on public.supplier_catalog
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy supplier_catalog_update on public.supplier_catalog
  for update to authenticated using ((select auth.uid()) is not null);
create policy supplier_catalog_delete on public.supplier_catalog
  for delete to authenticated using ((select auth.uid()) is not null);

drop policy if exists supplier_catalog_removed_select on public.supplier_catalog_removed;
drop policy if exists supplier_catalog_removed_insert on public.supplier_catalog_removed;
drop policy if exists supplier_catalog_removed_delete on public.supplier_catalog_removed;

create policy supplier_catalog_removed_select on public.supplier_catalog_removed
  for select to authenticated using ((select auth.uid()) is not null);
create policy supplier_catalog_removed_insert on public.supplier_catalog_removed
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy supplier_catalog_removed_delete on public.supplier_catalog_removed
  for delete to authenticated using ((select auth.uid()) is not null);

-- Deleting a catalog row remembers the deletion, so the seed cannot undo it.
create or replace function public.supplier_catalog_remember_removal()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.supplier_catalog_removed (supplier_id, item_id)
  values (old.supplier_id, old.item_id)
  on conflict (supplier_id, item_id) do nothing;

  return old;
end;
$function$;

drop trigger if exists supplier_catalog_remember_removal on public.supplier_catalog;

create trigger supplier_catalog_remember_removal
after delete on public.supplier_catalog
for each row execute function public.supplier_catalog_remember_removal();

notify pgrst, 'reload schema';

-- Proof.
do $$
declare
  v_orphan   int;
  v_supplier uuid;
  v_item     uuid;
begin
  -- 1. the link column exists and nothing existing was touched by adding it
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'supplier_orders'
      and column_name = 'supplier_id') then
    raise exception 'supplier_orders has no supplier_id column.';
  end if;

  select count(*) into v_orphan from public.supplier_orders where supplier_id is not null;

  if v_orphan <> 0 then
    raise exception 'Adding the column filled in % rows. It should fill none.', v_orphan;
  end if;

  -- 2. a deleted catalog row is remembered
  select id into v_supplier from public.suppliers limit 1;
  select id into v_item from public.inventory_items limit 1;

  if v_supplier is not null and v_item is not null then
    insert into public.supplier_catalog (supplier_id, item_id, supplier_sku, unit_price, is_preset)
    values (v_supplier, v_item, 'PROOF-ONLY', 1.00, true);

    delete from public.supplier_catalog
    where supplier_id = v_supplier and item_id = v_item and supplier_sku = 'PROOF-ONLY';

    if not exists (
      select 1 from public.supplier_catalog_removed
      where supplier_id = v_supplier and item_id = v_item) then
      raise exception 'Deleting a catalog row did not record the removal.';
    end if;

    -- leave nothing behind: this was a test, not a decision by the user
    delete from public.supplier_catalog_removed
    where supplier_id = v_supplier and item_id = v_item;
  end if;

  raise notice 'suppliers linked, and a deleted catalog row is remembered';
end $$;
