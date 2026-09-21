-- Profit and loss: the tables and views the page reads.
--
-- Run once against a Supabase (or plain Postgres 15+) database. Safe to run
-- again: every statement is create if not exists or create or replace.
--
-- What you get:
--   sales                    one row per sale: when, how much, what it cost
--   expense_import_batches   groups expenses that arrived together from a file
--   expenses                 overheads and one-offs, by category
--   pnl_expense_categories   expenses by month and category
--   pnl_monthly              revenue, cost of sales, expenses and profit by month
--
-- sales is the only table this file expects you to fill from your own system.
-- If you already record sales somewhere else, skip the sales table below and
-- replace it with a view of the same name and columns over your own data.

-- ---------------------------------------------------------------------------
-- sales
--
-- sale_date decides which month a sale counts in. amount is what was charged,
-- cost is what it cost you to deliver: goods, labour, anything that would not
-- have been spent without that sale. Overheads go in expenses, not here.
-- ---------------------------------------------------------------------------
create table if not exists public.sales (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  sale_date   date not null,
  amount      numeric(12,2) not null,
  cost        numeric(12,2) not null default 0,
  description text,
  constraint sales_amount_check check (amount >= 0),
  constraint sales_cost_check check (cost >= 0)
);

create index if not exists sales_sale_date_idx on public.sales (sale_date desc);

-- ---------------------------------------------------------------------------
-- expense_import_batches
--
-- A file of expenses imported together. Kept so a bad import can be reversed
-- as a unit rather than one row at a time. The page itself does not read it,
-- but expenses.import_batch points at it.
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
-- expenses
--
-- import_batch is set exactly when the row came from an import. The check
-- keeps that honest, so an imported row can always be traced to its batch and
-- a typed row can never claim one. on delete restrict means a batch cannot be
-- deleted out from under its rows: reverse by deleting the rows first.
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  spent_on     date not null,
  amount       numeric(10,2) not null,
  vendor       text,
  category     text not null,
  description  text,
  source       text not null default 'manual',
  import_batch uuid references public.expense_import_batches(id) on delete restrict,
  created_by   uuid references auth.users(id) default auth.uid(),
  constraint expenses_amount_check check (amount <> 0),
  constraint expenses_category_check check (btrim(category) <> ''),
  constraint expenses_source_check check (source in ('manual', 'import')),
  constraint expenses_batch_matches_source check (
    (source = 'import' and import_batch is not null)
    or (source = 'manual' and import_batch is null)
  )
);

create index if not exists expenses_spent_on_idx on public.expenses (spent_on desc);
create index if not exists expenses_category_idx on public.expenses (category);
create index if not exists expenses_import_batch_idx
  on public.expenses (import_batch) where import_batch is not null;

-- ---------------------------------------------------------------------------
-- pnl_expense_categories
-- ---------------------------------------------------------------------------
create or replace view public.pnl_expense_categories
with (security_invoker = true) as
select
  date_trunc('month', spent_on)::date as month,
  category,
  sum(amount)::numeric(12,2) as total,
  count(*)::integer as expense_count
from public.expenses
group by 1, 2;

-- ---------------------------------------------------------------------------
-- pnl_monthly
--
-- One row for every month that has a sale or an expense in it. A month with
-- only expenses still appears, with zero revenue, so a quiet month shows as a
-- loss rather than disappearing.
--
--   gross_profit = revenue - cost_of_sales
--   net_profit   = gross_profit - expenses
-- ---------------------------------------------------------------------------
create or replace view public.pnl_monthly
with (security_invoker = true) as
with sale_months as (
  select
    date_trunc('month', s.sale_date)::date as month,
    sum(s.amount) as revenue,
    sum(s.cost) as cost_of_sales,
    count(*) as sale_count
  from public.sales s
  group by 1
),
expense_months as (
  select
    date_trunc('month', e.spent_on)::date as month,
    sum(e.amount) as expense_total,
    count(*) as expense_count
  from public.expenses e
  group by 1
),
all_months as (
  select month from sale_months
  union
  select month from expense_months
)
select
  a.month,
  coalesce(s.revenue, 0)::numeric(12,2) as revenue,
  coalesce(s.cost_of_sales, 0)::numeric(12,2) as cost_of_sales,
  coalesce(x.expense_total, 0)::numeric(12,2) as expense_total,
  coalesce(s.sale_count, 0)::integer as sale_count,
  coalesce(x.expense_count, 0)::integer as expense_count,
  (coalesce(s.revenue, 0) - coalesce(s.cost_of_sales, 0))::numeric(12,2) as gross_profit,
  (coalesce(s.revenue, 0) - coalesce(s.cost_of_sales, 0)
    - coalesce(x.expense_total, 0))::numeric(12,2) as net_profit
from all_months a
left join sale_months s on s.month = a.month
left join expense_months x on x.month = a.month;

-- ---------------------------------------------------------------------------
-- access
--
-- Any signed in user may read and write. The views run as the caller
-- (security_invoker), so they see exactly what these policies allow. Tighten
-- these if not everyone who can sign in should see the books.
-- ---------------------------------------------------------------------------
alter table public.sales                  enable row level security;
alter table public.expenses               enable row level security;
alter table public.expense_import_batches enable row level security;

do $$
declare
  t text;
  op text;
begin
  foreach t in array array['sales', 'expenses', 'expense_import_batches'] loop
    foreach op in array array['select', 'insert', 'update', 'delete'] loop
      execute format('drop policy if exists %I on public.%I', t || '_' || op, t);
      if op = 'insert' then
        execute format(
          'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) is not null)',
          t || '_' || op, t);
      else
        execute format(
          'create policy %I on public.%I for %s to authenticated using ((select auth.uid()) is not null)',
          t || '_' || op, t, op);
      end if;
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';
