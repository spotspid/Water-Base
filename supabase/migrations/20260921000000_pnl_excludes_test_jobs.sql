-- Test jobs stay out of the profit and loss.
--
-- jobs.is_test was added so a job made to try the paperwork end to end could
-- live in the book without being counted. The dashboard honours it, the
-- schedule honours it, and the migration that added it said pnl_monthly would
-- "keep working", which it did, by counting test jobs like any other. Mark
-- one installed and its price arrives as revenue.
--
-- Both halves of the view that touch a job now skip test ones: the revenue,
-- parts and pay side, which reads job_margin, and the cash side, which reads
-- job_deposits directly and so needed its own join to jobs to know which
-- payments belonged to a test. Filtering only the first would have left a
-- test job's deposit counted as cash received.
--
-- job_margin itself is deliberately left alone. It is the row every job
-- screen and the agreement sender read by id, and a test job exists precisely
-- so that its drawer opens, its agreement sends and its work order prints.
-- Filtering it there would make the thing a test job is for impossible. The
-- places that count jobs filter is_test themselves, which is the rule this
-- file brings the P&L in line with.
--
-- Everything else in the view is the definition live since
-- 20260916000000_deposit_terms_and_cash_is_cash.sql, column for column, so
-- PnL.jsx and PnlCash.jsx read it unchanged.

create or replace view public.pnl_monthly
with (security_invoker = true) as
with job_months as (
  select
    date_trunc('month', coalesce(m.install_date, m.created_at::date))::date as month,
    sum(m.sale_price) as revenue,
    sum(m.parts_cost) as parts_cost,
    sum(m.installer_pay) as installer_pay,
    sum(greatest(m.balance_due, 0)) as balance_on_install,
    count(*) as job_count
  from public.job_margin m
  where m.status = 'installed'
    and not m.is_test
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
payment_months as (
  select
    date_trunc('month', d.received_on)::date as month,
    sum(d.amount) as payments_in,
    count(*) as payment_count
  from public.job_deposits d
  join public.jobs j on j.id = d.job_id
  where not j.is_test
  group by 1
),
all_months as (
  select month from job_months
  union
  select month from expense_months
  union
  select month from payment_months
)
select
  a.month,
  coalesce(j.revenue, 0)::numeric(12,2) as revenue,
  coalesce(j.parts_cost, 0)::numeric(12,2) as parts_cost,
  coalesce(j.installer_pay, 0)::numeric(12,2) as installer_pay,
  coalesce(x.expense_total, 0)::numeric(12,2) as expense_total,
  coalesce(j.job_count, 0)::integer as job_count,
  coalesce(x.expense_count, 0)::integer as expense_count,
  (coalesce(j.revenue, 0) - coalesce(j.parts_cost, 0) - coalesce(j.installer_pay, 0))::numeric(12,2)
    as gross_profit,
  (coalesce(j.revenue, 0) - coalesce(j.parts_cost, 0) - coalesce(j.installer_pay, 0)
    - coalesce(x.expense_total, 0))::numeric(12,2) as net_profit,
  (coalesce(j.revenue, 0) - coalesce(j.parts_cost, 0) - coalesce(j.installer_pay, 0)
    - coalesce(x.expense_total, 0))::numeric(12,2) as net,
  coalesce(p.payments_in, 0)::numeric(12,2) as deposits_in,
  coalesce(p.payment_count, 0)::integer as deposit_count,
  coalesce(j.balance_on_install, 0)::numeric(12,2) as balance_on_install,
  coalesce(p.payments_in, 0)::numeric(12,2) as cash_in
from all_months a
left join job_months j on j.month = a.month
left join expense_months x on x.month = a.month
left join payment_months p on p.month = a.month;

comment on view public.pnl_monthly is
  'Monthly profit and loss. Installed jobs and their payments, less expenses. Test jobs are excluded from every figure.';

do $$
declare
  v_view numeric;
  v_real numeric;
  v_cash_view numeric;
  v_cash_real numeric;
begin
  -- Revenue is exactly the installed, non test jobs. Compared against the
  -- tables directly rather than against the view's own arithmetic, so a
  -- filter that silently stopped applying would show up here.
  select coalesce(sum(revenue), 0) into v_view from public.pnl_monthly;
  select coalesce(sum(sale_price), 0) into v_real
  from public.jobs where status = 'installed' and not is_test;
  if v_view <> v_real then
    raise exception 'pnl revenue % does not match installed non test jobs %', v_view, v_real;
  end if;

  select coalesce(sum(cash_in), 0) into v_cash_view from public.pnl_monthly;
  select coalesce(sum(d.amount), 0) into v_cash_real
  from public.job_deposits d join public.jobs j on j.id = d.job_id where not j.is_test;
  if v_cash_view <> v_cash_real then
    raise exception 'pnl cash % does not match non test payments %', v_cash_view, v_cash_real;
  end if;

  -- job_margin still carries test jobs, because the screens that open one by
  -- id depend on it. If this ever fails, a drawer and an agreement send broke.
  if (select count(*) from public.job_margin where is_test)
     <> (select count(*) from public.jobs where is_test) then
    raise exception 'job_margin lost its test jobs';
  end if;
end $$;

notify pgrst, 'reload schema';
