-- A job that has not installed says what it is expected to cost.
--
-- Jobs reported 30,080.05 and Profit and loss reported 1,838.05, both labelled
-- as what the business had made, sixteen times apart and two clicks from each
-- other. Neither was a bug in the arithmetic. They were answering different
-- questions and neither said which.
--
-- Profit and loss counts installed jobs only, so it saw one job: 2,999 of
-- revenue less 1,160.95 of parts. Jobs counted every open contract, and for
-- the eight that had not installed it took their parts cost from the ledger,
-- where a job that has not installed has nothing. So eight jobs contributed
-- their entire sale price as profit. Ashley Fox read 100 percent margin, which
-- is not an optimistic estimate, it is an arithmetically impossible number
-- printed in the same typeface as a real one.
--
-- The cause was that "no parts recorded" and "no parts needed" were the same
-- value: zero. There was no third state for "not costed yet".
--
-- There is now, and it is earned rather than assumed: every scheduled job has
-- a resolved parts list, so the expected cost is known before the van loads.
-- resolve_job_parts is already what the reservation sync, the readiness report
-- and the install deduction all read, so the expected figure comes from the
-- same list that will produce the actual one. They cannot disagree about what
-- the job is made of, only about when it happened.
--
-- parts_cost_basis is the whole point. Four values, and the difference between
-- them is the difference between a figure and a guess:
--
--   actual    the job installed and these rows are in the ledger. Never moves
--             again, because the ledger is append only and each row carries
--             the cost stamped on it at the time.
--   expected  not installed, every line on its list resolves to a part. This
--             is what it will cost if nothing changes.
--   partial   not installed, and some lines cannot name a part yet. The sum is
--             a floor and not an estimate, so nothing is allowed to present it
--             as a profit figure.
--   none      no parts list at all. Not costed. Not zero.
--
-- margin is null for partial and none rather than optimistic. A blank that
-- says "not costed yet" is worth more than a number that is wrong, and this is
-- the specific rule that stops the 100 percent row coming back.

-- ---------------------------------------------------------------------------
-- the job view learns the difference between actual and expected
--
-- One lateral call to resolve_job_parts per job. That is a function call per
-- row, which would matter on a table of a hundred thousand; this is a view
-- over a job list that a person reads, and correctness is what was wrong with
-- it. If it ever needs to scale, the fix is a materialised expected cost
-- refreshed by the same triggers that resync the claim, not a cheaper lie.
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced: create or replace can only append columns to a
-- view, and expected_parts_cost belongs beside parts_cost rather than bolted
-- on the end where nobody reading the select would find it. pnl_monthly is the
-- only dependent, and it is rebuilt below.
drop view if exists public.pnl_monthly;
drop view if exists public.job_margin;

create view public.job_margin
with (security_invoker = true) as
with parts as (
  select
    j.id as job_id,
    r.total,
    r.lines,
    r.unresolved
  from public.jobs j
  left join lateral (
    select
      coalesce(sum(x.line_cost) filter (where x.resolved), 0)::numeric(10,2) as total,
      count(*)::int                                                          as lines,
      count(*) filter (where not x.resolved)::int                            as unresolved
    from public.resolve_job_parts(j.id) x
  ) r on true
)
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
  -- unchanged: what the ledger says, which is nothing until it installs
  coalesce(p.parts_cost, 0)::numeric(10,2)    as parts_cost,
  coalesce(p.parts_count, 0)::int             as parts_count,
  -- what the resolved list says it will cost, for a job that has not installed
  case when j.parts_deducted_at is null and coalesce(pt.lines, 0) > 0
    then pt.total
  end as expected_parts_cost,
  coalesce(pt.unresolved, 0)::int as unresolved_lines,
  case
    when j.parts_deducted_at is not null then 'actual'
    when coalesce(pt.lines, 0) = 0       then 'none'
    when coalesce(pt.unresolved, 0) > 0  then 'partial'
    else 'expected'
  end as parts_cost_basis,
  -- the one figure to put on screen, whichever half answered
  case
    when j.parts_deducted_at is not null then coalesce(p.parts_cost, 0)::numeric(10,2)
    when coalesce(pt.lines, 0) = 0       then null
    else pt.total
  end as parts_cost_effective,
  -- Gross profit: price less parts less installer pay. Null when the parts are
  -- not known, because the alternative is a number that cannot be true.
  case
    when j.parts_deducted_at is not null
      then (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0))::numeric(10,2)
    when coalesce(pt.lines, 0) = 0 or coalesce(pt.unresolved, 0) > 0
      then null
    else (j.sale_price - pt.total - coalesce(j.payout_amount, 0))::numeric(10,2)
  end as margin,
  case
    when j.sale_price is null or j.sale_price = 0 then null
    when j.parts_deducted_at is not null
      then round((j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0))
                 * 100.0 / j.sale_price, 1)
    when coalesce(pt.lines, 0) = 0 or coalesce(pt.unresolved, 0) > 0
      then null
    else round((j.sale_price - pt.total - coalesce(j.payout_amount, 0)) * 100.0 / j.sale_price, 1)
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
  coalesce(d.deposits_taken, 0)::numeric(10,2) as deposits_taken,
  coalesce(d.deposit_count, 0)::int            as deposit_count,
  d.last_deposit_on,
  (coalesce(j.sale_price, 0) - coalesce(d.deposits_taken, 0))::numeric(10,2) as balance_due,
  coalesce(jp.line_count, bs.line_count, 0)::int as template_line_count,
  j.collected_by,
  j.valve_type,
  j.payment_type,
  j.water_source,
  j.notes,
  j.payout_amount,
  (jp.line_count is not null) as has_job_parts
from public.jobs j
left join parts pt on pt.job_id = j.id
left join public.installers ins on ins.id = j.installer_id
left join public.installers hlp on hlp.id = j.helper_id
left join public.agreements ag on ag.job_id = j.id and ag.type = 'customer_install'
left join public.agreements wo on wo.job_id = j.id and wo.type = 'subcontractor_service'
left join (
  select t.job_id,
         sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)) as parts_cost,
         sum(-t.quantity)                                   as parts_count
  from public.inventory_transactions t
  where t.job_id is not null
  group by t.job_id
) p on p.job_id = j.id
left join (
  select job_id, sum(amount) as deposits_taken, count(*) as deposit_count,
         max(received_on) as last_deposit_on
  from public.job_deposits
  group by job_id
) d on d.job_id = j.id
left join (
  select template_id, count(*) as line_count
  from public.template_lines
  group by template_id
) bs on bs.template_id = j.template_id
left join (
  select job_id, count(*) as line_count
  from public.job_parts
  group by job_id
) jp on jp.job_id = j.id;

grant select on public.job_margin to authenticated;

-- ---------------------------------------------------------------------------
-- profit and loss names its own figure
--
-- The page called it "Net" and Jobs called its own figure "Margin", so the two
-- numbers on screen shared no word and invited the comparison that made them
-- look broken. Both are profit; they differ by scope, and the scope belongs in
-- the name.
--
--   gross_profit  revenue less parts less installer pay. The same arithmetic
--                 Jobs does, on installed jobs only, so the two pages can be
--                 reconciled by a person rather than only by whoever wrote
--                 them.
--   net_profit    gross profit less overheads. Kept as `net` too, because
--                 renaming a column other code selects is a separate change
--                 from adding the one that was missing.
--
-- pnl_monthly reads job_margin, so it inherits the expected cost work above
-- without change: it filters to installed, where the basis is always actual.
-- ---------------------------------------------------------------------------
create view public.pnl_monthly
with (security_invoker = true) as
with job_months as (
  select
    date_trunc('month', coalesce(m.install_date, m.created_at::date))::date as month,
    sum(m.sale_price)                            as revenue,
    sum(m.parts_cost)                            as parts_cost,
    sum(m.installer_pay)                         as installer_pay,
    sum(m.sale_price - m.deposits_taken)         as balance_on_install,
    count(*)                                     as job_count
  from public.job_margin m
  where m.status = 'installed'
  group by 1
),
expense_months as (
  select date_trunc('month', e.spent_on)::date as month,
         sum(e.amount) as expense_total,
         count(*)      as expense_count
  from public.expenses e
  group by 1
),
deposit_months as (
  select date_trunc('month', d.received_on)::date as month,
         sum(d.amount) as deposits_in,
         count(*)      as deposit_count
  from public.job_deposits d
  group by 1
),
all_months as (
  select month from job_months
  union select month from expense_months
  union select month from deposit_months
)
select
  a.month,
  coalesce(j.revenue, 0)::numeric(12,2)        as revenue,
  coalesce(j.parts_cost, 0)::numeric(12,2)     as parts_cost,
  coalesce(j.installer_pay, 0)::numeric(12,2)  as installer_pay,
  coalesce(x.expense_total, 0)::numeric(12,2)  as expense_total,
  coalesce(j.job_count, 0)::int                as job_count,
  coalesce(x.expense_count, 0)::int            as expense_count,
  (coalesce(j.revenue, 0) - coalesce(j.parts_cost, 0)
     - coalesce(j.installer_pay, 0))::numeric(12,2) as gross_profit,
  (coalesce(j.revenue, 0) - coalesce(j.parts_cost, 0)
     - coalesce(j.installer_pay, 0) - coalesce(x.expense_total, 0))::numeric(12,2) as net_profit,
  (coalesce(j.revenue, 0) - coalesce(j.parts_cost, 0)
     - coalesce(j.installer_pay, 0) - coalesce(x.expense_total, 0))::numeric(12,2) as net,
  coalesce(d.deposits_in, 0)::numeric(12,2)    as deposits_in,
  coalesce(d.deposit_count, 0)::int            as deposit_count,
  coalesce(j.balance_on_install, 0)::numeric(12,2) as balance_on_install,
  (coalesce(d.deposits_in, 0) + coalesce(j.balance_on_install, 0))::numeric(12,2) as cash_in
from all_months a
left join job_months j on j.month = a.month
left join expense_months x on x.month = a.month
left join deposit_months d on d.month = a.month;

grant select on public.pnl_monthly to authenticated;

-- ---------------------------------------------------------------------------
-- two expense categories that would double count
--
-- Parts reach the profit and loss from the inventory ledger, at the cost
-- stamped on each row when the job installed. Installer pay reaches it from
-- the job's payout. Filing the supplier invoice under "Equipment and Parts",
-- or the installer's cheque under "Subcontractor Pay", would subtract the same
-- money a second time and net would be wrong by the size of the real cost.
--
-- Deleted rather than deactivated, because no expense has ever used either:
-- there is no history to preserve and a deactivated row would sit in Settings
-- inviting the question. The guard on settings_options refuses a delete that
-- would strand a record, so this is safe by construction rather than by my
-- having checked.
-- ---------------------------------------------------------------------------
delete from public.settings_options
where list_key = 'expense_category'
  and value in ('Equipment and Parts', 'Subcontractor Pay');

-- ---------------------------------------------------------------------------
-- prove it
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad     int;
  v_actual  numeric;
  v_gross   numeric;
begin
  -- nothing may report a profit it cannot justify
  select count(*) into v_bad
  from public.job_margin
  where margin is not null
    and parts_cost_basis in ('partial', 'none');

  if v_bad <> 0 then
    raise exception '% job(s) report a profit with no parts figure behind it', v_bad;
  end if;

  -- an uncosted job may not read as 100 percent
  select count(*) into v_bad
  from public.job_margin
  where margin_pct = 100 and parts_cost_basis <> 'actual';

  if v_bad <> 0 then
    raise exception '% uninstalled job(s) still read as 100 percent', v_bad;
  end if;

  -- an installed job's figure is the ledger's and nothing else
  select count(*) into v_bad
  from public.job_margin
  where parts_cost_basis = 'actual'
    and (parts_cost_effective is distinct from parts_cost
         or expected_parts_cost is not null);

  if v_bad <> 0 then
    raise exception '% installed job(s) had their parts cost replaced by an estimate', v_bad;
  end if;

  -- and the two pages reconcile on installed work
  select coalesce(sum(margin), 0) into v_actual
  from public.job_margin where status = 'installed';

  select coalesce(sum(gross_profit), 0) into v_gross from public.pnl_monthly;

  if v_actual <> v_gross then
    raise exception 'installed gross profit disagrees: jobs %, profit and loss %',
      v_actual, v_gross;
  end if;

  -- net is still gross less overheads
  if exists (
    select 1 from public.pnl_monthly
    where net_profit <> gross_profit - expense_total
  ) then
    raise exception 'net profit is not gross profit less expenses';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from public.settings_options
    where list_key = 'expense_category'
      and value in ('Equipment and Parts', 'Subcontractor Pay')
  ) then
    raise exception 'a double counting expense category survived';
  end if;
end $$;

notify pgrst, 'reload schema';
