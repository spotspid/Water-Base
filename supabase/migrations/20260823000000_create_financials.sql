-- financial tracking: expenses, CSV import batches, and the P and L views.
--
-- three things this migration deliberately does not invent:
--   installer payout   jobs.payout_amount already holds a flat per job amount
--                      and job_margin already subtracts it. nothing to add.
--   parts cost         summed from the ledger by job_margin. read, never redefined.
--   expense categories a managed list in settings_options, like every other
--                      operator editable vocabulary in this app.

-- ---------------------------------------------------------------------------
-- expense categories join the existing pick lists.
--
-- the list_key check is widened rather than dropped, same as when time_window
-- was added. it is what stops a typo creating a list nothing reads.
-- ---------------------------------------------------------------------------
alter table public.settings_options
  drop constraint if exists settings_options_list_key_check;

alter table public.settings_options
  add constraint settings_options_list_key_check
  check (list_key in (
    'inventory_category', 'service_city', 'faucet_finish', 'payment_type',
    'time_window', 'expense_category'));

insert into public.settings_options (list_key, value, sort_order)
select 'expense_category', v, (i * 10)
from unnest(array[
  'Equipment and Parts',
  'Subcontractor Pay',
  'Advertising',
  'Software and Subscriptions',
  'Vehicle and Fuel',
  'Storage',
  'Insurance',
  'Permits',
  'Professional Fees',
  'Other'
]) with ordinality as t(v, i)
on conflict (list_key, value) do nothing;

-- ---------------------------------------------------------------------------
-- expense_import_batches: one row per committed import.
--
-- source names the row producer that fed it. csv is the only one wired up
-- today, pdf is listed now so adding a Claude extraction path later is a code
-- change in the producer alone, not a migration and not a constraint edit.
--
-- a reversed batch keeps its row. reversed_at is what makes the reversal
-- visible afterwards rather than silently leaving a gap in the numbering.
-- ---------------------------------------------------------------------------
create table if not exists public.expense_import_batches (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  source       text not null default 'csv' check (source in ('csv', 'pdf', 'manual')),
  filename     text,
  row_count    int not null default 0,
  total_amount numeric(12,2) not null default 0,
  created_by   uuid references auth.users(id) default auth.uid(),
  reversed_at  timestamptz,
  reversed_by  uuid references auth.users(id)
);

create index if not exists expense_import_batches_created_idx
  on public.expense_import_batches (created_at desc);

-- ---------------------------------------------------------------------------
-- expenses.
--
-- import_batch is nullable because a manual expense belongs to no batch. the
-- two source values are kept honest by a check rather than by convention, so
-- an imported row can always be traced back to the batch that created it and
-- a manual row can never claim a batch it did not come from.
--
-- on delete restrict on import_batch means a batch cannot be deleted out from
-- under its rows. reversal removes the expenses first, then marks the batch.
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  spent_on     date not null,
  amount       numeric(10,2) not null check (amount <> 0),
  vendor       text,
  category     text not null check (btrim(category) <> ''),
  description  text,
  source       text not null default 'manual' check (source in ('manual', 'import')),
  import_batch uuid references public.expense_import_batches(id) on delete restrict,
  created_by   uuid references auth.users(id) default auth.uid(),
  constraint expenses_batch_matches_source check (
    (source = 'import' and import_batch is not null)
    or (source = 'manual' and import_batch is null)
  )
);

create index if not exists expenses_spent_on_idx
  on public.expenses (spent_on desc);

create index if not exists expenses_category_idx
  on public.expenses (category);

create index if not exists expenses_import_batch_idx
  on public.expenses (import_batch)
  where import_batch is not null;

-- the triple the duplicate check compares on, so the preview stays fast as
-- the table grows. vendor is folded to lower case here and in the function
-- so "Ferguson" and "ferguson" are the same supplier.
create index if not exists expenses_dupe_idx
  on public.expenses (spent_on, amount, lower(btrim(coalesce(vendor, ''))));

-- ---------------------------------------------------------------------------
-- teach the settings usage counter about expense categories, so removing one
-- that expenses still reference is refused with the same message as the rest.
-- ---------------------------------------------------------------------------
create or replace function public.settings_option_usage(p_list_key text, p_value text)
returns int
language sql
stable
security invoker
set search_path = public, pg_temp
as $usage$
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
    when 'time_window' then
      (select count(*) from public.jobs where time_window = p_value)
    when 'expense_category' then
      (select count(*) from public.expenses where category = p_value)
    else 0
  end)::int
$usage$;

-- ---------------------------------------------------------------------------
-- expense_duplicate_matches: flag, do not block.
--
-- takes the candidate rows as jsonb and answers which of them already look
-- like an existing expense on date plus amount plus vendor. the preview shows
-- the answer and still lets the operator commit, because a genuine repeat
-- charge from the same supplier on the same day for the same amount is a
-- normal thing that happens.
--
-- ordinality gives the caller back its own array positions, so the UI does
-- not have to match rows up by value.
-- ---------------------------------------------------------------------------
create or replace function public.expense_duplicate_matches(p_rows jsonb)
returns table (row_index int, match_count int, sample_id uuid, sample_spent_on date)
language sql
stable
security invoker
set search_path = public, pg_temp
as $dupes$
  select
    (r.idx - 1)::int                as row_index,
    count(e.id)::int                as match_count,
    (array_agg(e.id order by e.created_at desc))[1]       as sample_id,
    (array_agg(e.spent_on order by e.created_at desc))[1] as sample_spent_on
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as r(item, idx)
  join public.expenses e
    on e.spent_on = (r.item->>'spent_on')::date
   and e.amount   = (r.item->>'amount')::numeric
   and lower(btrim(coalesce(e.vendor, ''))) = lower(btrim(coalesce(r.item->>'vendor', '')))
  group by r.idx
$dupes$;

-- ---------------------------------------------------------------------------
-- commit_expense_batch: the whole import lands or none of it does.
--
-- a function rather than a client side loop, so a network drop halfway
-- through cannot leave a batch holding some of its rows. p_source is the
-- producer name, which is the only thing the commit step needs to know about
-- where the rows came from.
-- ---------------------------------------------------------------------------
create or replace function public.commit_expense_batch(
  p_source   text,
  p_filename text,
  p_rows     jsonb
)
returns table (batch_id uuid, inserted_count int, total_amount numeric)
language plpgsql
security invoker
set search_path = public, pg_temp
as $commit$
declare
  v_batch uuid;
  v_count int;
  v_total numeric;
  v_bad   int;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There are no rows to import.'
      using errcode = 'WB020';
  end if;

  if coalesce(p_source, '') not in ('csv', 'pdf', 'manual') then
    raise exception 'Unknown import source "%".', coalesce(p_source, '')
      using errcode = 'WB020';
  end if;

  -- every row needs a category that is actually on the list, checked up front
  -- so the failure names the problem instead of surfacing as a check violation
  select count(*) into v_bad
  from jsonb_array_elements(p_rows) as t(item)
  where not exists (
    select 1 from public.settings_options o
    where o.list_key = 'expense_category'
      and o.value = (t.item->>'category')
  );

  if v_bad > 0 then
    raise exception '% row(s) have a category that is not on the expense category list. Add it in Settings, or map those rows to an existing category.', v_bad
      using errcode = 'WB020';
  end if;

  insert into public.expense_import_batches (source, filename)
  values (p_source, nullif(btrim(coalesce(p_filename, '')), ''))
  returning id into v_batch;

  insert into public.expenses
    (spent_on, amount, vendor, category, description, source, import_batch)
  select
    (item->>'spent_on')::date,
    round((item->>'amount')::numeric, 2),
    nullif(btrim(coalesce(item->>'vendor', '')), ''),
    item->>'category',
    nullif(btrim(coalesce(item->>'description', '')), ''),
    'import',
    v_batch
  from jsonb_array_elements(p_rows) as t(item);

  select count(*), coalesce(sum(amount), 0)
    into v_count, v_total
  from public.expenses
  where import_batch = v_batch;

  update public.expense_import_batches
  set row_count = v_count, total_amount = v_total
  where id = v_batch;

  return query select v_batch, v_count, v_total;
end;
$commit$;

-- ---------------------------------------------------------------------------
-- reverse_expense_batch: undo one import as a unit.
--
-- the expenses go, the batch row stays and is stamped. that ordering matters,
-- because import_batch is on delete restrict.
-- ---------------------------------------------------------------------------
create or replace function public.reverse_expense_batch(p_batch_id uuid)
returns table (removed_count int)
language plpgsql
security invoker
set search_path = public, pg_temp
as $reverse$
declare
  v_reversed timestamptz;
  v_removed  int;
begin
  select reversed_at into v_reversed
  from public.expense_import_batches
  where id = p_batch_id;

  if not found then
    raise exception 'That import batch no longer exists.'
      using errcode = 'WB021';
  end if;

  if v_reversed is not null then
    raise exception 'That import was already reversed on %.', to_char(v_reversed, 'Mon DD, YYYY')
      using errcode = 'WB022';
  end if;

  delete from public.expenses where import_batch = p_batch_id;
  get diagnostics v_removed = row_count;

  update public.expense_import_batches
  set reversed_at = now(), reversed_by = (select auth.uid())
  where id = p_batch_id;

  return query select v_removed;
end;
$reverse$;

-- ---------------------------------------------------------------------------
-- pnl_monthly: one row per month that had either revenue or spending.
--
-- revenue, parts cost and installer pay all come from job_margin so there is
-- exactly one definition of each in the database. an installed job lands in
-- the month it was installed, falling back to when it was written up for the
-- few older rows that carry no install date.
--
-- a full outer join because a month can have expenses and no installs, or
-- installs and no expenses, and dropping either would misstate the year.
-- ---------------------------------------------------------------------------
create or replace view public.pnl_monthly
with (security_invoker = true) as
with job_months as (
  select
    date_trunc('month', coalesce(m.install_date, m.created_at::date))::date as month,
    sum(m.sale_price)    as revenue,
    sum(m.parts_cost)    as parts_cost,
    sum(m.installer_pay) as installer_pay,
    count(*)             as job_count
  from public.job_margin m
  where m.status = 'installed'
  group by 1
),
expense_months as (
  select
    date_trunc('month', e.spent_on)::date as month,
    sum(e.amount) as expense_total,
    count(*)      as expense_count
  from public.expenses e
  group by 1
)
select
  coalesce(j.month, x.month)                     as month,
  coalesce(j.revenue, 0)::numeric(12,2)          as revenue,
  coalesce(j.parts_cost, 0)::numeric(12,2)       as parts_cost,
  coalesce(j.installer_pay, 0)::numeric(12,2)    as installer_pay,
  coalesce(x.expense_total, 0)::numeric(12,2)    as expense_total,
  coalesce(j.job_count, 0)::int                  as job_count,
  coalesce(x.expense_count, 0)::int              as expense_count,
  (coalesce(j.revenue, 0)
    - coalesce(j.parts_cost, 0)
    - coalesce(j.installer_pay, 0)
    - coalesce(x.expense_total, 0))::numeric(12,2) as net
from job_months j
full outer join expense_months x on x.month = j.month;

-- ---------------------------------------------------------------------------
-- pnl_expense_categories: the expense_total column above, broken out.
-- ---------------------------------------------------------------------------
create or replace view public.pnl_expense_categories
with (security_invoker = true) as
select
  date_trunc('month', e.spent_on)::date as month,
  e.category,
  sum(e.amount)::numeric(12,2) as total,
  count(*)::int                as expense_count
from public.expenses e
group by 1, 2;

-- ---------------------------------------------------------------------------
-- installer pay has no configured default any more.
--
-- the amount varies by installer and by job, so a single house rate was
-- prefilling a number that was wrong more often than right. the field on the
-- job stays exactly as it was, and every payout already recorded is untouched.
-- ---------------------------------------------------------------------------
delete from public.app_settings where key in ('installer_pay_mode', 'installer_pay_rate');

alter table public.app_settings drop constraint if exists app_settings_pay_mode;
alter table public.app_settings drop constraint if exists app_settings_pay_rate;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.expenses              enable row level security;
alter table public.expense_import_batches enable row level security;

drop policy if exists "expenses_select" on public.expenses;
drop policy if exists "expenses_insert" on public.expenses;
drop policy if exists "expenses_update" on public.expenses;
drop policy if exists "expenses_delete" on public.expenses;

create policy "expenses_select" on public.expenses
  for select to authenticated using ((select auth.uid()) is not null);
create policy "expenses_insert" on public.expenses
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy "expenses_update" on public.expenses
  for update to authenticated using ((select auth.uid()) is not null);
create policy "expenses_delete" on public.expenses
  for delete to authenticated using ((select auth.uid()) is not null);

drop policy if exists "expense_import_batches_select" on public.expense_import_batches;
drop policy if exists "expense_import_batches_insert" on public.expense_import_batches;
drop policy if exists "expense_import_batches_update" on public.expense_import_batches;
drop policy if exists "expense_import_batches_delete" on public.expense_import_batches;

create policy "expense_import_batches_select" on public.expense_import_batches
  for select to authenticated using ((select auth.uid()) is not null);
create policy "expense_import_batches_insert" on public.expense_import_batches
  for insert to authenticated with check ((select auth.uid()) is not null);
create policy "expense_import_batches_update" on public.expense_import_batches
  for update to authenticated using ((select auth.uid()) is not null);
create policy "expense_import_batches_delete" on public.expense_import_batches
  for delete to authenticated using ((select auth.uid()) is not null);

grant execute on function public.expense_duplicate_matches(jsonb) to authenticated;
grant execute on function public.commit_expense_batch(text, text, jsonb) to authenticated;
grant execute on function public.reverse_expense_batch(uuid) to authenticated;

notify pgrst, 'reload schema';
