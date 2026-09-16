-- A deposit is a term of the sale, and cash is only what actually arrived.
--
-- Two things were wrong with how money read.
--
-- A deposit was only ever a payment row. Nothing on the job said a deposit had
-- been agreed, so the customer agreement printed "full payment is due upon
-- installation completion" on every sale, including the ones where a deposit
-- was asked for up front. deposit_amount is that term: typed at quoting, thirty
-- percent of the price offered as a starting figure on the form and nothing
-- more than that. It is a number, not a rule, so the table stores whatever was
-- agreed and refuses only what cannot be true: a negative deposit, or one
-- larger than the sale.
--
-- Payments are unchanged and still one kind of record. job_deposits keeps its
-- name because renaming a table every query reads is a separate change from
-- fixing what it means, but every row in it is simply a payment. A deposit, a
-- completion payment, an Affirm settlement and a Zelle transfer are all rows,
-- and balance_due is the sale price less their sum. There is no special case
-- and there must never be one, because a special case is where a job paid in
-- two halves by two methods stops adding up.
--
-- The profit and loss counted cash that never came. Its cash figure was the
-- payments taken plus "balance on install", which assumed an installed job was
-- paid in full on the day. Walter Radu installed in August with nothing
-- recorded, so his record said he owed 2,999 while the profit and loss said
-- 2,999 had been collected. Both could not be true, and the record was the one
-- telling it straight. Cash in is now the payments received that month and
-- nothing else. balance_on_install was always the right figure for what an
-- installed job still owes; the fault was adding it to cash. It stays, and
-- outstanding_balances lists it job by job.
--
-- Written to be safe while the page that reads it is still the old one. No
-- column is renamed or removed, and the sixteen argument edit function stays
-- as a wrapper that keeps the deposit a job already has. The deployed page and
-- the new one both work against this, so there is no window where saving a job
-- or opening the profit and loss fails.
--
-- Revenue does not move. It is earned when the work is done, whether or not
-- the money has arrived, which is the difference between revenue and cash.

-- ---------------------------------------------------------------------------
-- the term
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists deposit_amount numeric(10,2);

comment on column public.jobs.deposit_amount is
  'The deposit agreed at quoting. Null when none was recorded, zero when the '
  'sale takes no deposit. A term, not a payment: payments are job_deposits rows.';

alter table public.jobs drop constraint if exists jobs_deposit_amount_check;
alter table public.jobs
  add constraint jobs_deposit_amount_check
  check (deposit_amount is null or (deposit_amount >= 0 and deposit_amount <= sale_price));

-- ---------------------------------------------------------------------------
-- Affirm, which a customer can pay with, so it is a method a payment can carry
-- ---------------------------------------------------------------------------
insert into public.settings_options (list_key, value, sort_order)
select 'payment_type', 'Affirm',
       coalesce((select max(sort_order) from public.settings_options
                 where list_key = 'payment_type'), 0) + 10
on conflict (list_key, value) do update set active = true;

-- ---------------------------------------------------------------------------
-- editing a saved job carries the deposit
--
-- Same rules as every other field on the form. A value that is there must be
-- sensible. A deposit that was never recorded may stay unrecorded. A deposit
-- that was recorded cannot be blanked, because blank and zero mean different
-- things: zero is "no deposit was agreed", blank is "nobody wrote it down".
-- Editable on an installed job, because it is a term of the sale and not
-- something the ledger was written from.
--
-- A new seventeen argument form. The body is 20260912000000 with the deposit
-- added in three places, marked below. p_deposit_amount has no default, so a
-- call naming sixteen arguments can only match the wrapper further down and
-- PostgREST never has two functions to choose between.
-- ---------------------------------------------------------------------------
create or replace function public.update_job_details(
  p_job_id          uuid,
  p_customer_name   text,
  p_phone           text,
  p_customer_email  text,
  p_address         text,
  p_city            text,
  p_water_source    text,
  p_template_id     uuid,
  p_sale_price      numeric,
  p_payment_type    text,
  p_faucet_finish   text,
  p_ro_type         text,
  p_valve_type      text,
  p_invoice_number  text,
  p_site_conditions text,
  p_notes           text,
  p_deposit_amount  numeric
)
returns json
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_job       public.jobs%rowtype;
  v_label     text;
  v_override  boolean;
  v_blocked   text[] := '{}';
  v_open      int := 0;
  v_units     int := 0;
  v_unresolved int := 0;
  v_name      text := nullif(btrim(coalesce(p_customer_name, '')), '');
  v_phone     text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email     text := nullif(btrim(coalesce(p_customer_email, '')), '');
  v_address   text := nullif(btrim(coalesce(p_address, '')), '');
  v_invoice   text := nullif(btrim(coalesce(p_invoice_number, '')), '');
  v_finish    text := nullif(btrim(coalesce(p_faucet_finish, '')), '');
  v_ro        text := nullif(btrim(coalesce(p_ro_type, '')), '');
  v_valve     text := nullif(btrim(coalesce(p_valve_type, '')), '');
  v_city      text := nullif(btrim(coalesce(p_city, '')), '');
  v_payment   text := nullif(btrim(coalesce(p_payment_type, '')), '');
  v_source    text := nullif(btrim(coalesce(p_water_source, '')), '');
  v_cleared   text[] := '{}';
begin
  if p_job_id is null then
    raise exception 'No job was given to edit.' using errcode = 'WB026';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;

  if not found then
    raise exception 'That job no longer exists. Reload the jobs list.' using errcode = 'WB026';
  end if;

  if v_name is null and nullif(btrim(coalesce(v_job.customer_name, '')), '') is not null then
    v_cleared := v_cleared || 'the customer name'::text;
  end if;

  if v_phone is null and nullif(btrim(coalesce(v_job.phone, '')), '') is not null then
    v_cleared := v_cleared || 'the phone number'::text;
  end if;

  if v_address is null and nullif(btrim(coalesce(v_job.address, '')), '') is not null then
    v_cleared := v_cleared || 'the address'::text;
  end if;

  if v_city is null and nullif(btrim(coalesce(v_job.city, '')), '') is not null then
    v_cleared := v_cleared || 'the city'::text;
  end if;

  if v_payment is null and nullif(btrim(coalesce(v_job.payment_type, '')), '') is not null then
    v_cleared := v_cleared || 'the payment type'::text;
  end if;

  if v_invoice is null and nullif(btrim(coalesce(v_job.invoice_number, '')), '') is not null then
    v_cleared := v_cleared || 'the invoice number'::text;
  end if;

  -- deposit, 1 of 3: a recorded deposit is not blanked. Zero says none.
  if p_deposit_amount is null and v_job.deposit_amount is not null then
    v_cleared := v_cleared || 'the deposit'::text;
  end if;

  if array_length(v_cleared, 1) is not null then
    raise exception
      '% cannot be emptied once set. Correct the value rather than clearing it, '
      'or leave it as it was. A field that was already blank on this job can stay blank.%',
      initcap(array_to_string(v_cleared, ', ')),
      case when 'the deposit' = any(v_cleared) then ' For no deposit, enter 0.' else '' end
      using errcode = 'WB026';
  end if;

  if v_source is null or v_source not in ('city', 'well') then
    raise exception 'Water source must be city or well.' using errcode = 'WB026';
  end if;

  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'That email address does not look right.' using errcode = 'WB026';
  end if;

  if p_sale_price is null or p_sale_price < 0 then
    raise exception 'Sale price must be zero or greater.' using errcode = 'WB026';
  end if;

  -- deposit, 2 of 3: sensible when present, in a sentence rather than as the
  -- check constraint's name
  if p_deposit_amount is not null and p_deposit_amount < 0 then
    raise exception 'The deposit must be zero or more.' using errcode = 'WB026';
  end if;

  if p_deposit_amount is not null and p_deposit_amount > p_sale_price then
    raise exception 'The deposit is more than the sale price. Lower the deposit, or raise the price.'
      using errcode = 'WB026';
  end if;

  select exists (select 1 from public.job_parts jp where jp.job_id = p_job_id)
    into v_override;

  if p_template_id is not null then
    select t.label into v_label from public.system_templates t where t.id = p_template_id;

    if v_label is null then
      raise exception 'That build sheet no longer exists. Reload and pick another.'
        using errcode = 'WB026';
    end if;
  elsif v_override then
    v_label := v_job.system_template;
  elsif v_job.template_id is not null then
    raise exception
      'Taking the build sheet off this job would leave it with no parts list at all, '
      'so it would install and record nothing. Pick another sheet, or list this '
      'job''s parts against the job first.'
      using errcode = 'WB026';
  else
    v_label := v_job.system_template;
  end if;

  if v_job.parts_deducted_at is not null then
    if p_template_id is distinct from v_job.template_id then
      v_blocked := v_blocked || 'the build sheet'::text;
    end if;

    if v_finish is distinct from v_job.faucet_finish then
      v_blocked := v_blocked || 'the faucet finish'::text;
    end if;

    if v_ro is distinct from v_job.ro_type then
      v_blocked := v_blocked || 'the RO type'::text;
    end if;

    if v_valve is distinct from v_job.valve_type then
      v_blocked := v_blocked || 'the valve type'::text;
    end if;

    if v_invoice is distinct from v_job.invoice_number then
      v_blocked := v_blocked || 'the invoice number'::text;
    end if;

    if array_length(v_blocked, 1) is not null then
      raise exception
        'This job installed on % and its parts are in the ledger, which is append '
        'only. % cannot be changed: the ledger rows were written from %, and they '
        'record what actually left the shelf. Everything else on this job can still '
        'be edited. Reverse the install if the parts themselves were wrong.',
        to_char(v_job.parts_deducted_at, 'Mon FMDD, YYYY'),
        initcap(array_to_string(v_blocked, ', ')),
        case when array_length(v_blocked, 1) = 1 then 'it' else 'them' end
        using errcode = 'WB026';
    end if;
  end if;

  update public.jobs
  set customer_name   = coalesce(v_name, customer_name),
      phone           = coalesce(v_phone, phone),
      customer_email  = v_email,
      address         = coalesce(v_address, address),
      city            = v_city,
      water_source    = v_source,
      template_id     = p_template_id,
      system_template = v_label,
      sale_price      = p_sale_price,
      payment_type    = v_payment,
      faucet_finish   = v_finish,
      ro_type         = v_ro,
      valve_type      = v_valve,
      invoice_number  = v_invoice,
      site_conditions = nullif(btrim(coalesce(p_site_conditions, '')), ''),
      notes           = nullif(btrim(coalesce(p_notes, '')), ''),
      -- deposit, 3 of 3
      deposit_amount  = p_deposit_amount
  where id = p_job_id;

  select count(*)::int, coalesce(sum(jr.quantity), 0)::int
    into v_open, v_units
  from public.job_reservations jr
  where jr.job_id = p_job_id and jr.released_at is null;

  select count(*)::int into v_unresolved
  from public.resolve_job_parts(p_job_id) r
  where not r.resolved;

  return json_build_object(
    'job_id',           p_job_id,
    'system_template',  v_label,
    'open_lines',       v_open,
    'units_committed',  v_units,
    'unresolved_lines', v_unresolved,
    'from_job_parts',   v_override,
    'claimed',          v_job.scheduled_date is not null
                          and v_job.status not in ('installed', 'cancelled')
                          and v_job.parts_deducted_at is null
  );
end;
$fn$;

revoke all on function public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric,
  text, text, text, text, text, text, text, numeric) from public;

grant execute on function public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric,
  text, text, text, text, text, text, text, numeric) to authenticated;

-- The sixteen argument form, for the page deployed before this one. It passes
-- the job's current deposit through, so saving from the old form neither sets
-- nor clears the term. Nothing in the repo calls it once the new page is out,
-- and it can be dropped in a later migration.
create or replace function public.update_job_details(
  p_job_id          uuid,
  p_customer_name   text,
  p_phone           text,
  p_customer_email  text,
  p_address         text,
  p_city            text,
  p_water_source    text,
  p_template_id     uuid,
  p_sale_price      numeric,
  p_payment_type    text,
  p_faucet_finish   text,
  p_ro_type         text,
  p_valve_type      text,
  p_invoice_number  text,
  p_site_conditions text,
  p_notes           text
)
returns json
language sql
set search_path = public, pg_temp
as $wrap$
  select public.update_job_details(
    p_job_id, p_customer_name, p_phone, p_customer_email, p_address, p_city,
    p_water_source, p_template_id, p_sale_price, p_payment_type, p_faucet_finish,
    p_ro_type, p_valve_type, p_invoice_number, p_site_conditions, p_notes,
    (select j.deposit_amount from public.jobs j where j.id = p_job_id))
$wrap$;

revoke all on function public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric,
  text, text, text, text, text, text, text) from public;

grant execute on function public.update_job_details(
  uuid, text, text, text, text, text, text, uuid, numeric,
  text, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- the job view carries the term and what is left of it
--
-- Appended, so create or replace keeps every existing column exactly where it
-- was. The body is 20260914000000 unchanged apart from the last two columns.
-- ---------------------------------------------------------------------------
create or replace view public.job_margin
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
  (jp.line_count is not null) as has_job_parts,
  -- the deposit agreed at quoting, and how much of it has not arrived yet.
  -- Null when no term was ever recorded, which is not the same as zero.
  j.deposit_amount,
  case
    when j.deposit_amount is null then null
    else greatest(j.deposit_amount - coalesce(d.deposits_taken, 0), 0)::numeric(10,2)
  end as deposit_outstanding
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
-- profit and loss: cash is what arrived
--
-- Replaced in place, with every column keeping its name, type and position.
-- Two definitions change and nothing else:
--
--   cash_in              payments received in the month, whatever they were
--                        for, and nothing else. It used to add
--                        balance_on_install, which is the whole fault.
--   balance_on_install   on jobs installed in the month, what has not been
--                        paid yet, as of today. The same figure it always
--                        was, clamped at zero so a job paid over its price
--                        does not hide another job's debt. Not cash, and not
--                        added to anything.
--
-- deposits_in and deposit_count keep their names so the deployed page keeps
-- working, but they have always counted every payment, deposit or not, and
-- the page labels them that way.
-- ---------------------------------------------------------------------------
create or replace view public.pnl_monthly
with (security_invoker = true) as
with job_months as (
  select
    date_trunc('month', coalesce(m.install_date, m.created_at::date))::date as month,
    sum(m.sale_price)                  as revenue,
    sum(m.parts_cost)                  as parts_cost,
    sum(m.installer_pay)               as installer_pay,
    sum(greatest(m.balance_due, 0))    as balance_on_install,
    count(*)                           as job_count
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
payment_months as (
  select date_trunc('month', d.received_on)::date as month,
         sum(d.amount) as payments_in,
         count(*)      as payment_count
  from public.job_deposits d
  group by 1
),
all_months as (
  select month from job_months
  union select month from expense_months
  union select month from payment_months
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
  coalesce(p.payments_in, 0)::numeric(12,2)    as deposits_in,
  coalesce(p.payment_count, 0)::int            as deposit_count,
  coalesce(j.balance_on_install, 0)::numeric(12,2) as balance_on_install,
  coalesce(p.payments_in, 0)::numeric(12,2)    as cash_in
from all_months a
left join job_months j     on j.month = a.month
left join expense_months x on x.month = a.month
left join payment_months p on p.month = a.month;

grant select on public.pnl_monthly to authenticated;

-- ---------------------------------------------------------------------------
-- what is outstanding, across every job
--
-- One row per job with money in either direction still to settle. owed_state
-- says which kind, because the same subtraction means four different things
-- depending on where the job is:
--
--   owed_now       installed, and the price is not covered. Money owed now.
--   deposit_due    not installed, and the agreed deposit has not all arrived.
--                  amount_owed is what is left of the deposit, not the price.
--   on_completion  not installed, deposit settled or none agreed. The rest is
--                  due when the work is done, so it is expected, not late.
--   owed_back      paid more than the price, or paid anything on a job that
--                  was cancelled. Owed to the customer, not by them.
--
-- A job with nothing to settle is not listed. A cancelled job with nothing
-- paid is not listed either, because it owes nothing and is owed nothing.
-- ---------------------------------------------------------------------------
create or replace view public.outstanding_balances
with (security_invoker = true) as
with classified as (
  select
    m.*,
    case
      when m.status = 'cancelled' and m.deposits_taken > 0.005   then 'owed_back'
      when m.status = 'cancelled'                                 then null
      when m.balance_due < -0.005                                 then 'owed_back'
      when m.status = 'installed' and m.balance_due > 0.005       then 'owed_now'
      when coalesce(m.deposit_outstanding, 0) > 0.005             then 'deposit_due'
      when m.balance_due > 0.005                                  then 'on_completion'
    end as owed_state
  from public.job_margin m
)
select
  c.id                  as job_id,
  c.customer_name,
  c.city,
  c.status,
  c.system_template,
  c.invoice_number,
  c.scheduled_date,
  c.install_date,
  c.sale_price,
  c.deposit_amount,
  c.deposit_outstanding,
  c.deposits_taken      as paid,
  c.deposit_count       as payment_count,
  c.last_deposit_on     as last_payment_on,
  c.balance_due,
  c.owed_state,
  (case c.owed_state
     when 'owed_now'      then c.balance_due
     when 'deposit_due'   then c.deposit_outstanding
     when 'on_completion' then c.balance_due
     when 'owed_back'     then case when c.status = 'cancelled' then c.deposits_taken
                                    else -c.balance_due end
   end)::numeric(10,2)  as amount_owed,
  case when c.status = 'installed' and c.install_date is not null
    then (current_date - c.install_date)
  end                   as days_since_install
from classified c
where c.owed_state is not null;

grant select on public.outstanding_balances to authenticated;

-- ---------------------------------------------------------------------------
-- prove it
-- ---------------------------------------------------------------------------
do $$
declare
  v_paid numeric;
  v_cash numeric;
  v_owed numeric;
  v_view numeric;
  v_bad  int;
begin
  -- cash in is exactly the payments, across every month, and nothing more
  select coalesce(sum(amount), 0) into v_paid from public.job_deposits;
  select coalesce(sum(cash_in), 0) into v_cash from public.pnl_monthly;

  if v_paid <> v_cash then
    raise exception 'cash in is %, but % was received', v_cash, v_paid;
  end if;

  -- what installed jobs still owe agrees between the monthly view and the list
  select coalesce(sum(balance_on_install), 0) into v_owed from public.pnl_monthly;
  select coalesce(sum(amount_owed), 0) into v_view
  from public.outstanding_balances where owed_state = 'owed_now';

  if v_owed <> v_view then
    raise exception 'still owed disagrees: profit and loss %, outstanding list %', v_owed, v_view;
  end if;

  -- every installed job's price is what was paid plus what is owed
  select count(*) into v_bad
  from public.job_margin
  where status = 'installed'
    and sale_price <> deposits_taken + balance_due;

  if v_bad <> 0 then
    raise exception '% installed job(s) do not add up to their price', v_bad;
  end if;

  -- the reconciliation 20260914000000 promised still holds
  if (select coalesce(sum(margin), 0) from public.job_margin where status = 'installed')
     <> (select coalesce(sum(gross_profit), 0) from public.pnl_monthly) then
    raise exception 'installed gross profit no longer reconciles between jobs and profit and loss';
  end if;

  if not exists (
    select 1 from public.settings_options
    where list_key = 'payment_type' and value = 'Affirm' and active
  ) then
    raise exception 'Affirm is not an active payment type';
  end if;
end $$;

-- the deposit guards, inside a block that rolls back
do $$
declare
  v_job     public.jobs%rowtype;
  v_refused boolean;
  v_left    numeric;
begin
  select * into v_job from public.jobs where sale_price > 0 order by created_at limit 1;
  if v_job.id is null then return; end if;

  begin
    v_refused := false;
    begin
      update public.jobs set deposit_amount = v_job.sale_price + 1 where id = v_job.id;
    exception when check_violation then v_refused := true;
    end;
    if not v_refused then raise exception 'a deposit above the sale price was accepted'; end if;

    v_refused := false;
    begin
      update public.jobs set deposit_amount = -1 where id = v_job.id;
    exception when check_violation then v_refused := true;
    end;
    if not v_refused then raise exception 'a negative deposit was accepted'; end if;

    -- the edit function saves one
    perform public.update_job_details(
      v_job.id, v_job.customer_name, v_job.phone, v_job.customer_email,
      v_job.address, v_job.city, v_job.water_source, v_job.template_id,
      v_job.sale_price, v_job.payment_type, v_job.faucet_finish, v_job.ro_type,
      v_job.valve_type, v_job.invoice_number, v_job.site_conditions, v_job.notes,
      round(v_job.sale_price * 0.3, 2));

    if (select deposit_amount from public.jobs where id = v_job.id)
       is distinct from round(v_job.sale_price * 0.3, 2) then
      raise exception 'update_job_details did not save the deposit';
    end if;

    -- and refuses to blank it afterwards
    v_refused := false;
    begin
      perform public.update_job_details(
        v_job.id, v_job.customer_name, v_job.phone, v_job.customer_email,
        v_job.address, v_job.city, v_job.water_source, v_job.template_id,
        v_job.sale_price, v_job.payment_type, v_job.faucet_finish, v_job.ro_type,
        v_job.valve_type, v_job.invoice_number, v_job.site_conditions, v_job.notes,
        null);
    exception when sqlstate 'WB026' then v_refused := true;
    end;
    if not v_refused then raise exception 'a recorded deposit was allowed to be blanked'; end if;

    -- a payment draws the deposit down, and the price down, with no special case
    insert into public.job_deposits (job_id, amount, received_on)
    values (v_job.id, 100, current_date);

    select deposit_outstanding into v_left from public.job_margin where id = v_job.id;

    if v_left <> round(v_job.sale_price * 0.3, 2) - 100 then
      raise exception 'deposit_outstanding is %, not drawn down by the payment', v_left;
    end if;

    raise exception 'PROOF_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'PROOF_ROLLBACK' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
