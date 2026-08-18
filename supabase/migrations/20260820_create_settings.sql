-- operator editable settings.
--
-- everything here used to be a hardcoded array in src/lib/constants.js. what
-- stays hardcoded is what is structural rather than operational:
--   STATUS_LABELS  job status is a check constraint on jobs, and the install
--                  functions branch on it, so renaming one is a code change
--   PICK_SOURCES   each source needs a matching branch in the SQL function
--                  resolve_template_parts, so adding one is a code change

-- ---------------------------------------------------------------------------
-- settings_options: the simple pick lists. the stored value is also the label,
-- because that same text is what lands on jobs.city, jobs.payment_type,
-- jobs.faucet_finish and inventory_items.category.
-- ---------------------------------------------------------------------------
create table if not exists public.settings_options (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  list_key   text not null check (list_key in (
               'inventory_category', 'service_city', 'faucet_finish', 'payment_type')),
  value      text not null check (btrim(value) <> ''),
  sort_order int not null default 0,
  active     boolean not null default true,
  unique (list_key, value)
);

create index if not exists settings_options_list_idx
  on public.settings_options (list_key, sort_order);

-- ---------------------------------------------------------------------------
-- transaction_types: replaces the TXN_TYPES array. direction is what the log
-- form uses to turn a positive count into a signed ledger quantity.
--   1 adds to on hand, -1 removes from on hand, 0 lets the user choose.
-- is_system marks the five the application itself depends on. auto deduct
-- writes install rows and reversal writes return rows, so those cannot be
-- renamed, redirected, deactivated or deleted from the UI or from SQL.
-- ---------------------------------------------------------------------------
create table if not exists public.transaction_types (
  value      text primary key check (btrim(value) <> ''),
  label      text not null check (btrim(label) <> ''),
  direction  int not null check (direction in (-1, 0, 1)),
  help       text,
  sort_order int not null default 0,
  active     boolean not null default true,
  is_system  boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.transaction_types (value, label, direction, help, sort_order, is_system)
values
  ('purchase',   'Purchase',   1, 'Stock received into inventory',        10, true),
  ('return',     'Return',     1, 'Stock returned to inventory',          20, true),
  ('install',    'Install',   -1, 'Stock consumed on a job',              30, true),
  ('damage',     'Damage',    -1, 'Stock written off as damaged',         40, true),
  ('adjustment', 'Adjustment', 0, 'Manual count correction, either direction', 50, true)
on conflict (value) do nothing;

-- the ledger used a fixed check constraint. point it at the table instead so
-- an operator can add a type without a migration, while referential integrity
-- still stops a row referencing a type that does not exist.
alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_txn_type_check;

do $fk$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'inventory_transactions_txn_type_fkey'
  ) then
    alter table public.inventory_transactions
      add constraint inventory_transactions_txn_type_fkey
      foreign key (txn_type) references public.transaction_types(value)
      on update cascade on delete restrict;
  end if;
end
$fk$;

-- ---------------------------------------------------------------------------
-- app_settings: the scalars. seeded with the values already in force, never
-- with an invented number. installer_pay_rate starts at zero, which means
-- "no default, type it per job", exactly how the form behaves today.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key           text primary key,
  numeric_value numeric,
  text_value    text,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) default auth.uid(),
  constraint app_settings_pay_mode check (
    key <> 'installer_pay_mode' or text_value in ('flat', 'percent')),
  constraint app_settings_pay_rate check (
    key <> 'installer_pay_rate' or (numeric_value is not null and numeric_value >= 0)),
  constraint app_settings_location check (
    key <> 'default_location' or btrim(coalesce(text_value, '')) <> '')
);

insert into public.app_settings (key, numeric_value, text_value)
values
  ('installer_pay_mode', null, 'flat'),
  ('installer_pay_rate', 0,    null),
  ('default_location',   null, 'Unit 4030')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- settings_option_usage: how many live rows still reference an option. the
-- settings page calls this before offering to remove one, and the delete
-- guard below calls it again so the answer is enforced, not just displayed.
-- ---------------------------------------------------------------------------
create or replace function public.settings_option_usage(p_list_key text, p_value text)
returns int
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select (case p_list_key
    when 'inventory_category' then
      (select count(*) from public.inventory_items where category = p_value)
      + (select count(*) from public.template_lines where pick_category = p_value)
    when 'service_city' then
      (select count(*) from public.jobs where city = p_value)
    when 'faucet_finish' then
      (select count(*) from public.jobs where faucet_finish = p_value)
    when 'payment_type' then
      (select count(*) from public.jobs where payment_type = p_value)
    else 0
  end)::int
$$;

create or replace function public.settings_options_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  v_count := public.settings_option_usage(old.list_key, old.value);

  if v_count > 0 then
    raise exception 'Cannot remove "%" because % existing %. Turn it off instead so it stays on old records but stops appearing in new ones.',
      old.value, v_count,
      case when v_count = 1 then 'record still uses it' else 'records still use it' end
      using errcode = 'WB010';
  end if;

  return old;
end;
$$;

drop trigger if exists settings_options_guard on public.settings_options;

create trigger settings_options_guard
  before delete on public.settings_options
  for each row execute function public.settings_options_guard();

-- ---------------------------------------------------------------------------
-- transaction_types_guard: the five seeded types are load bearing. install and
-- return are written by mark_job_installed and revert_job_install, and the
-- others are the vocabulary the inventory page was built around.
-- ---------------------------------------------------------------------------
create or replace function public.transaction_types_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then
      raise exception 'The "%" type is built in and cannot be removed. The application writes it automatically.', old.label
        using errcode = 'WB011';
    end if;
    return old;
  end if;

  if old.is_system then
    if new.value <> old.value then
      raise exception 'The "%" type is built in, so its code cannot be renamed. Change its label instead.', old.label
        using errcode = 'WB011';
    end if;
    if new.direction <> old.direction then
      raise exception 'The "%" type is built in, so its direction is fixed.', old.label
        using errcode = 'WB011';
    end if;
    if not new.active then
      raise exception 'The "%" type is built in and stays available. The application writes it automatically.', old.label
        using errcode = 'WB011';
    end if;
    if not new.is_system then
      raise exception 'The "%" type cannot stop being built in.', old.label
        using errcode = 'WB011';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists transaction_types_guard on public.transaction_types;

create trigger transaction_types_guard
  before update or delete on public.transaction_types
  for each row execute function public.transaction_types_guard();

-- ---------------------------------------------------------------------------
-- seed the pick lists from the arrays that used to live in constants.js
-- ---------------------------------------------------------------------------
insert into public.settings_options (list_key, value, sort_order)
select 'inventory_category', v, (i * 10)
from unnest(array[
  'Softener', 'RO System', 'Filter', 'Media', 'Faucet', 'Fittings',
  'Tubing', 'Valve', 'Tank', 'Consumable', 'Tools', 'Other'
]) with ordinality as t(v, i)
on conflict (list_key, value) do nothing;

insert into public.settings_options (list_key, value, sort_order)
select 'service_city', v, (i * 10)
from unnest(array[
  'Ann Arbor', 'Brighton', 'Canton', 'Chelsea', 'Dexter', 'Dundee', 'Howell',
  'Livonia', 'Milan', 'Monroe', 'Northville', 'Plymouth', 'Saline',
  'South Lyon', 'Superior Township', 'Tecumseh', 'Whitmore Lake', 'Ypsilanti'
]) with ordinality as t(v, i)
on conflict (list_key, value) do nothing;

insert into public.settings_options (list_key, value, sort_order)
select 'faucet_finish', v, (i * 10)
from unnest(array[
  'Chrome', 'Brushed Nickel', 'Matte Black', 'Oil-Rubbed Bronze', 'Polished Gold'
]) with ordinality as t(v, i)
on conflict (list_key, value) do nothing;

insert into public.settings_options (list_key, value, sort_order)
select 'payment_type', v, (i * 10)
from unnest(array['Cash', 'Check', 'Credit Card', 'Financing']) with ordinality as t(v, i)
on conflict (list_key, value) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.settings_options   enable row level security;
alter table public.transaction_types  enable row level security;
alter table public.app_settings       enable row level security;

drop policy if exists "settings_options_select" on public.settings_options;
drop policy if exists "settings_options_insert" on public.settings_options;
drop policy if exists "settings_options_update" on public.settings_options;
drop policy if exists "settings_options_delete" on public.settings_options;

create policy "settings_options_select" on public.settings_options
  for select to authenticated using ((select auth.uid()) is not null);
create policy "settings_options_insert" on public.settings_options
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy "settings_options_update" on public.settings_options
  for update to authenticated using ((select auth.uid()) is not null);
create policy "settings_options_delete" on public.settings_options
  for delete to authenticated using ((select auth.uid()) is not null);

drop policy if exists "transaction_types_select" on public.transaction_types;
drop policy if exists "transaction_types_insert" on public.transaction_types;
drop policy if exists "transaction_types_update" on public.transaction_types;
drop policy if exists "transaction_types_delete" on public.transaction_types;

create policy "transaction_types_select" on public.transaction_types
  for select to authenticated using ((select auth.uid()) is not null);
create policy "transaction_types_insert" on public.transaction_types
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy "transaction_types_update" on public.transaction_types
  for update to authenticated using ((select auth.uid()) is not null);
create policy "transaction_types_delete" on public.transaction_types
  for delete to authenticated using ((select auth.uid()) is not null);

drop policy if exists "app_settings_select" on public.app_settings;
drop policy if exists "app_settings_insert" on public.app_settings;
drop policy if exists "app_settings_update" on public.app_settings;

create policy "app_settings_select" on public.app_settings
  for select to authenticated using ((select auth.uid()) is not null);
create policy "app_settings_insert" on public.app_settings
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy "app_settings_update" on public.app_settings
  for update to authenticated using ((select auth.uid()) is not null);

grant execute on function public.settings_option_usage(text, text) to authenticated;

notify pgrst, 'reload schema';
