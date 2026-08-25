-- Deposits taken against a job.
--
-- Freeform on purpose. There is no percentage, no schedule and no rule about
-- what a deposit should be, because in this business there is not one: some
-- customers pay a third, some pay half, some hand over five hundred dollars
-- and some pay nothing until the van leaves. Any rule encoded here would be
-- wrong for most of the book, so the table records what happened and declines
-- to have an opinion about it.
--
-- More than one per job, because a customer can pay in stages.
--
-- Balance due is derived and never stored. Storing it would create a second
-- place for the truth to live, and the first thing that happens to a stored
-- balance is that somebody edits the sale price and it stops agreeing.

create table if not exists public.job_deposits (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  job_id      uuid not null references public.jobs(id) on delete cascade,

  -- Non zero rather than positive. A negative one is a refund, which is a real
  -- thing that happens and which the arithmetic handles without any special
  -- case: the balance goes back up and the cash goes back down. The
  -- alternative is deleting the original deposit, which loses the history of
  -- money that genuinely moved twice.
  amount      numeric(10,2) not null check (amount <> 0),

  received_on date not null,
  method      text,
  note        text,

  created_by  uuid references auth.users(id) default auth.uid()
);

comment on table public.job_deposits is
  'Money taken against a job before it is finished. No percentage logic and no '
  'rules: this records what was paid and when, nothing more.';

comment on column public.job_deposits.amount is
  'Non zero. A negative amount is a refund, which keeps the history of money '
  'that moved twice rather than deleting the deposit that was really taken.';

create index if not exists job_deposits_job_idx
  on public.job_deposits (job_id, received_on desc);

create index if not exists job_deposits_month_idx
  on public.job_deposits (received_on);

create or replace function public.job_deposits_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

revoke execute on function public.job_deposits_touch() from public, anon, authenticated;

drop trigger if exists job_deposits_touch on public.job_deposits;
create trigger job_deposits_touch before update on public.job_deposits
  for each row execute function public.job_deposits_touch();

alter table public.job_deposits enable row level security;

do $$
declare c text;
begin
  foreach c in array array['select', 'insert', 'update', 'delete'] loop
    execute format('drop policy if exists %I on public.job_deposits', 'job_deposits_' || c);
  end loop;

  execute 'create policy job_deposits_select on public.job_deposits
             for select to authenticated using ((select auth.uid()) is not null)';
  execute 'create policy job_deposits_insert on public.job_deposits
             for insert to authenticated with check ((select auth.uid()) is not null)';
  execute 'create policy job_deposits_update on public.job_deposits
             for update to authenticated using ((select auth.uid()) is not null)';
  execute 'create policy job_deposits_delete on public.job_deposits
             for delete to authenticated using ((select auth.uid()) is not null)';
end $$;

-- ---------------------------------------------------------------------------
-- job_margin carries what has been taken and what is left
--
-- Appended at the end, because create or replace view can add columns but
-- cannot reorder the ones already there.
-- ---------------------------------------------------------------------------
create or replace view public.job_margin
with (security_invoker = true) as
select
  j.id,
  j.created_at,
  j.customer_name,
  j.city,
  j.system_template,
  j.template_id,
  j.status,
  j.install_date,
  j.installer,
  j.invoice_number,
  j.faucet_finish,
  j.parts_deducted_at,
  j.parts_deduct_batch,
  j.sale_price,
  coalesce(j.payout_amount, 0)::numeric(10,2) as installer_pay,
  coalesce(p.parts_cost, 0)::numeric(10,2)    as parts_cost,
  coalesce(p.parts_count, 0)::int             as parts_count,
  (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0))::numeric(10,2) as margin,
  case
    when j.sale_price is null or j.sale_price = 0 then null
    else round(
      (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0)) * 100.0 / j.sale_price,
      1)
  end as margin_pct,
  j.address,
  j.phone,
  j.scheduled_date,
  j.time_window,
  j.installer_id,
  ins.name  as installer_name,
  j.helper_id,
  hlp.name  as helper_name,
  j.customer_email,
  j.agreement_status,
  j.agreement_signed_url,
  ag.id            as agreement_id,
  ag.sent_at       as agreement_sent_at,
  ag.completed_at  as agreement_completed_at,
  ag.audit_log_url as agreement_audit_log_url,
  ag.last_error    as agreement_last_error,
  ag.send_count    as agreement_send_count,
  j.ro_type,
  wo.id                  as work_order_id,
  wo.status              as work_order_status,
  wo.sent_at             as work_order_sent_at,
  wo.completed_at        as work_order_completed_at,
  wo.signed_document_url as work_order_signed_url,
  wo.audit_log_url       as work_order_audit_log_url,
  wo.last_error          as work_order_last_error,
  wo.send_count          as work_order_send_count,
  ins.email              as installer_email,
  j.site_conditions,
  coalesce(ag.view_count, 0)::int as agreement_view_count,
  coalesce(wo.view_count, 0)::int as work_order_view_count,
  j.nag_snoozed_until,
  -- deposits
  coalesce(d.deposits_taken, 0)::numeric(10,2)          as deposits_taken,
  coalesce(d.deposit_count, 0)::int                     as deposit_count,
  d.last_deposit_on,
  (coalesce(j.sale_price, 0) - coalesce(d.deposits_taken, 0))::numeric(10,2) as balance_due
from public.jobs j
left join public.installers ins on ins.id = j.installer_id
left join public.installers hlp on hlp.id = j.helper_id
left join public.agreements ag
  on ag.job_id = j.id and ag.type = 'customer_install'
left join public.agreements wo
  on wo.job_id = j.id and wo.type = 'subcontractor_service'
left join (
  select
    t.job_id,
    sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)) as parts_cost,
    sum(-t.quantity)                                   as parts_count
  from public.inventory_transactions t
  where t.job_id is not null
  group by t.job_id
) p on p.job_id = j.id
left join (
  select
    job_id,
    sum(amount)       as deposits_taken,
    count(*)          as deposit_count,
    max(received_on)  as last_deposit_on
  from public.job_deposits
  group by job_id
) d on d.job_id = j.id;

-- ---------------------------------------------------------------------------
-- cash, kept apart from revenue
--
-- A deposit is not extra income. It is the same money as part of the sale
-- price, arriving earlier, so adding it to revenue would count one sale twice
-- and adding it to net would report a profit that has not been earned.
--
-- What it belongs in is a cash figure, and the arithmetic that stops the
-- double count is subtraction rather than exclusion:
--
--   deposits in         what was actually handed over this month
--   balance on install  the rest of the price, on the month it was installed,
--                       which is the sale price less every deposit already
--                       taken against that job
--
-- Sum those over any job's whole life and you get the sale price exactly once.
-- Three thousand sold, five hundred down in August, installed in September:
-- August takes 500, September takes 2,500, and September still recognises the
-- full 3,000 as revenue because that is when the work was done.
--
-- The balance half is an assumption and worth naming: nothing records the
-- payment taken at the door, so this treats an installed job as paid in full.
-- If a job installs and the customer still owes money, the cash figure is
-- early rather than wrong, and the balance due on the job record is the place
-- that would show it.
-- ---------------------------------------------------------------------------
create or replace view public.pnl_monthly
with (security_invoker = true) as
with job_months as (
  select
    date_trunc('month', coalesce(m.install_date, m.created_at::date))::date as month,
    sum(m.sale_price)                          as revenue,
    sum(m.parts_cost)                          as parts_cost,
    sum(m.installer_pay)                       as installer_pay,
    sum(m.sale_price - m.deposits_taken)       as balance_on_install,
    count(*)                                   as job_count
  from public.job_margin m
  where m.status = 'installed'
  group by 1
),
expense_months as (
  select
    date_trunc('month', e.spent_on)::date as month,
    sum(e.amount)                         as expense_total,
    count(*)                              as expense_count
  from public.expenses e
  group by 1
),
deposit_months as (
  select
    date_trunc('month', d.received_on)::date as month,
    sum(d.amount)                            as deposits_in,
    count(*)                                 as deposit_count
  from public.job_deposits d
  group by 1
),
all_months as (
  select month from job_months
  union
  select month from expense_months
  union
  select month from deposit_months
)
select
  a.month,
  coalesce(j.revenue, 0)::numeric(12,2)         as revenue,
  coalesce(j.parts_cost, 0)::numeric(12,2)      as parts_cost,
  coalesce(j.installer_pay, 0)::numeric(12,2)   as installer_pay,
  coalesce(x.expense_total, 0)::numeric(12,2)   as expense_total,
  coalesce(j.job_count, 0)::int                 as job_count,
  coalesce(x.expense_count, 0)::int             as expense_count,
  (coalesce(j.revenue, 0) - coalesce(j.parts_cost, 0)
    - coalesce(j.installer_pay, 0) - coalesce(x.expense_total, 0))::numeric(12,2) as net,
  -- cash, which is deliberately not part of net above
  coalesce(d.deposits_in, 0)::numeric(12,2)          as deposits_in,
  coalesce(d.deposit_count, 0)::int                  as deposit_count,
  coalesce(j.balance_on_install, 0)::numeric(12,2)   as balance_on_install,
  (coalesce(d.deposits_in, 0) + coalesce(j.balance_on_install, 0))::numeric(12,2) as cash_in
from all_months a
left join job_months j     on j.month = a.month
left join expense_months x on x.month = a.month
left join deposit_months d on d.month = a.month;

comment on view public.pnl_monthly is
  'Accrual figures and cash figures side by side but never mixed. Revenue and '
  'net recognise a job in the month it was installed. Cash in is deposits '
  'received plus the balance left on jobs installed that month, which sums to '
  'each sale price exactly once.';

notify pgrst, 'reload schema';
