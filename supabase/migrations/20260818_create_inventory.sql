-- inventory module: item catalog, transaction ledger, derived stock view.
-- architecture rule: on hand is never stored or edited directly.
-- it is always summed from inventory_transactions via the inventory_stock view.

-- item catalog
create table if not exists public.inventory_items (
  id                 uuid primary key default gen_random_uuid(),
  created_at         timestamptz not null default now(),
  sku                text unique not null,
  name               text not null,
  category           text not null,
  variant            text,
  unit_cost          numeric(10,2) not null default 0,
  reorder_threshold  int not null default 0,
  active             boolean not null default true,
  notes              text
);

-- ledger. every stock change is one new row here, never an update to a total.
create table if not exists public.inventory_transactions (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  item_id           uuid not null references public.inventory_items(id) on delete restrict,
  quantity          int not null,
  txn_type          text not null check (txn_type in ('purchase', 'install', 'adjustment', 'return', 'damage')),
  job_id            uuid references public.jobs(id) on delete set null,
  unit_cost_at_txn  numeric(10,2),
  location          text default 'Unit 4030',
  reference         text,
  note              text,
  created_by        uuid references auth.users(id) default auth.uid()
);

-- indexes
create index if not exists inventory_transactions_item_id_idx
  on public.inventory_transactions (item_id);

create index if not exists inventory_transactions_job_id_idx
  on public.inventory_transactions (job_id);

create index if not exists inventory_transactions_created_at_idx
  on public.inventory_transactions (created_at desc);

-- derived stock view.
-- security_invoker so the base table RLS policies apply to the calling user.
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
  coalesce(sum(t.quantity), 0)::int as on_hand,
  round(coalesce(sum(t.quantity), 0) * i.unit_cost, 2) as stock_value
from public.inventory_items i
left join public.inventory_transactions t on t.item_id = i.id
group by i.id;

-- enable RLS
alter table public.inventory_items enable row level security;
alter table public.inventory_transactions enable row level security;

-- inventory_items policies (drop first so this is idempotent)
drop policy if exists "inventory_items_select" on public.inventory_items;
drop policy if exists "inventory_items_insert" on public.inventory_items;
drop policy if exists "inventory_items_update" on public.inventory_items;
drop policy if exists "inventory_items_delete" on public.inventory_items;

create policy "inventory_items_select" on public.inventory_items
  for select to authenticated
  using ((select auth.uid()) is not null);

create policy "inventory_items_insert" on public.inventory_items
  for insert to authenticated
  with check ((select auth.uid()) is not null);

create policy "inventory_items_update" on public.inventory_items
  for update to authenticated
  using ((select auth.uid()) is not null);

create policy "inventory_items_delete" on public.inventory_items
  for delete to authenticated
  using ((select auth.uid()) is not null);

-- inventory_transactions policies (drop first so this is idempotent)
drop policy if exists "inventory_transactions_select" on public.inventory_transactions;
drop policy if exists "inventory_transactions_insert" on public.inventory_transactions;
drop policy if exists "inventory_transactions_update" on public.inventory_transactions;
drop policy if exists "inventory_transactions_delete" on public.inventory_transactions;

create policy "inventory_transactions_select" on public.inventory_transactions
  for select to authenticated
  using ((select auth.uid()) is not null);

create policy "inventory_transactions_insert" on public.inventory_transactions
  for insert to authenticated
  with check ((select auth.uid()) is not null);

create policy "inventory_transactions_update" on public.inventory_transactions
  for update to authenticated
  using ((select auth.uid()) is not null);

create policy "inventory_transactions_delete" on public.inventory_transactions
  for delete to authenticated
  using ((select auth.uid()) is not null);

-- reload PostgREST schema cache
notify pgrst, 'reload schema';
