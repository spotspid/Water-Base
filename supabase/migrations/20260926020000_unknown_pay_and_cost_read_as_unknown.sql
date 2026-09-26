-- A missing installer payout and a missing part cost now read as unknown.
--
-- Two blanks were being costed as zero, and both of them flattered the
-- profit. A job with no payout was priced as though the crew worked for
-- nothing. A part with no cost was priced as though the supplier gave it
-- away. Neither said so anywhere: both arrived on screen as $0.00, in the
-- same typeface as a figure somebody had actually entered.
--
-- The distinction this file introduces is between zero and not known.
--
--   inventory_items.unit_cost = 0     deliberately free. The two control
--                                     valves are the real case: their opening
--                                     count says the valve is already inside
--                                     the landed cost of each system, so
--                                     costing it again would double count it.
--   inventory_items.unit_cost = null  nobody has recorded what it costs.
--
-- jobs.payout_amount was already nullable and already meant that. What was
-- wrong there was job_margin, which coalesced it to zero before anything read
-- it, so the distinction was thrown away one layer below every screen.
--
-- What changes as a result:
--
--   installer_pay        null rather than 0 when no payout is recorded.
--   parts_cost           sums only the ledger rows that carry a stamped cost.
--   parts_cost_basis     gains 'unpriced': every line names a part, but at
--                        least one of those parts has no cost recorded.
--   parts_cost_effective for 'unpriced' this is a floor, the same way
--                        'partial' already was: at least this much.
--   margin, margin_pct   null unless the pay is known and the parts are fully
--                        costed. They were already null for 'partial' and
--                        'none'; they now also stand down for unknown pay and
--                        for a part with no cost.
--   pay_known            new, so a screen can say which of the two is missing.
--   uncosted_parts_lines new, how many lines or ledger rows have no cost.
--   profit_basis         new, the reason a profit figure is or is not shown.
--                        The parts reasons first, then 'no_pay', because a
--                        parts list that cannot be costed is the larger hole.
--
-- Nothing is blocked that was allowed before. An item can still be created
-- without a cost and a job can still install without a payout. They simply
-- stop being counted as free.
--
-- pnl_monthly keeps summing what it knows, because one job missing a payout
-- should not blank a whole month, and gains two counts so the page can say
-- how many jobs are behind that caveat. Today both are zero: every installed
-- job has a payout and every deducted row has a stamped cost.

-- 1. Unknown becomes recordable.

alter table public.inventory_items
  alter column unit_cost drop not null,
  alter column unit_cost drop default;

comment on column public.inventory_items.unit_cost is
  'What one unit costs us. Null means nobody has recorded it, and every figure '
  'built on it reads as unknown rather than as zero. Zero means deliberately '
  'free, which is true of the control valves, already inside the landed cost '
  'of the system they ship with.';

-- 2. The resolvers stop inventing a zero.
--
-- line_cost becomes null when the item it names has no cost. resolved is
-- deliberately untouched: it answers "does this line name a part", which is
-- what the deduction and the reservations depend on, and a part with no cost
-- is still a part that leaves the shelf.

create or replace function public.resolve_template_parts(
  p_template_id uuid,
  p_faucet_finish text default null,
  p_ro_type text default null,
  p_valve_type text default null
)
returns table(
  line_id uuid, line_type text, pick_source text, pick_category text,
  quantity integer, item_id uuid, sku text, item_name text, item_variant text,
  unit_cost numeric, line_cost numeric, resolved boolean, sort_order integer
)
language sql
stable
set search_path to 'public', 'pg_temp'
as $function$
  select
    tl.id,
    tl.line_type,
    tl.pick_source,
    tl.pick_category,
    tl.quantity,
    coalesce(tl.item_id, pick.id),
    coalesce(fixed_item.sku, pick.sku),
    coalesce(fixed_item.name, pick.name),
    coalesce(fixed_item.variant, pick.variant),
    coalesce(fixed_item.unit_cost, pick.unit_cost),
    (tl.quantity * coalesce(fixed_item.unit_cost, pick.unit_cost))::numeric(10,2),
    coalesce(tl.item_id, pick.id) is not null,
    tl.sort_order
  from public.template_lines tl
  left join public.inventory_items fixed_item on fixed_item.id = tl.item_id
  left join lateral (
    select i.id, i.sku, i.name, i.variant, i.unit_cost
    from public.inventory_items i
    where tl.line_type = 'customer_pick'
      and i.category = tl.pick_category
      and i.active
      and i.variant = case tl.pick_source
                        when 'faucet_finish' then p_faucet_finish
                        when 'ro_type'       then p_ro_type
                        when 'valve_type'    then p_valve_type
                      end
    order by i.created_at, i.id
    limit 1
  ) pick on true
  where tl.template_id = p_template_id
    and not (
      coalesce(p_ro_type, '') = 'No RO'
      and (
        coalesce(tl.pick_source, '') in ('ro_type', 'faucet_finish')
        or (tl.line_type = 'fixed' and coalesce(fixed_item.category, '') = 'RO')
      )
    )
  order by tl.sort_order, tl.id
$function$;

create or replace function public.resolve_job_parts(p_job_id uuid)
returns table(
  line_id uuid, line_type text, pick_source text, pick_category text,
  quantity integer, item_id uuid, sku text, item_name text, item_variant text,
  unit_cost numeric, line_cost numeric, resolved boolean, sort_order integer,
  source text
)
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job public.jobs%rowtype;
begin
  if p_job_id is null then
    return;
  end if;

  select * into v_job from public.jobs where id = p_job_id;

  if not found then
    return;
  end if;

  if exists (select 1 from public.job_parts jp where jp.job_id = p_job_id) then
    return query
    select
      jp.id,
      'job_override'::text,
      null::text,
      i.category,
      jp.quantity,
      jp.item_id,
      i.sku,
      i.name,
      i.variant,
      i.unit_cost,
      (jp.quantity * i.unit_cost)::numeric(10,2),
      true,
      jp.sort_order,
      'job'::text
    from public.job_parts jp
    join public.inventory_items i on i.id = jp.item_id
    where jp.job_id = p_job_id
    order by jp.sort_order, jp.created_at, jp.id;

    return;
  end if;

  return query
  select
    r.line_id, r.line_type, r.pick_source, r.pick_category, r.quantity,
    r.item_id, r.sku, r.item_name, r.item_variant, r.unit_cost, r.line_cost,
    r.resolved, r.sort_order, 'template'::text
  from public.resolve_template_parts(
         v_job.template_id, v_job.faucet_finish, v_job.ro_type, v_job.valve_type) r;
end;
$function$;

-- 3. The two preview views stop inventing one either.

create or replace view public.template_line_preview
with (security_invoker = true) as
select
  tl.id,
  tl.template_id,
  tl.line_type,
  tl.item_id,
  tl.pick_source,
  tl.pick_category,
  tl.quantity,
  tl.sort_order,
  tl.note,
  i.sku,
  i.name as item_name,
  i.category as item_category,
  i.variant as item_variant,
  i.unit_cost,
  (tl.quantity::numeric * i.unit_cost)::numeric(10,2) as line_cost
from public.template_lines tl
left join public.inventory_items i on i.id = tl.item_id;

create or replace view public.job_reservation_lines
with (security_invoker = true) as
select
  jr.id,
  jr.created_at,
  jr.job_id,
  jr.item_id,
  jr.quantity,
  j.customer_name,
  j.status as job_status,
  j.install_date,
  j.invoice_number,
  i.sku,
  i.name as item_name,
  i.category as item_category,
  i.variant as item_variant,
  i.unit_cost,
  (jr.quantity::numeric * i.unit_cost)::numeric(10,2) as line_cost
from public.job_reservations jr
join public.jobs j on j.id = jr.job_id
join public.inventory_items i on i.id = jr.item_id
where jr.released_at is null;

-- 4. job_margin.
--
-- Column for column the definition live since 20260917030000_quoted_status,
-- with the coalesces that hid the two blanks removed and three columns added
-- at the end. The basis is computed once, in a lateral, because it is now
-- read by four expressions and three copies of a five branch case is how
-- they drift apart.

create or replace view public.job_margin
with (security_invoker = true) as
with parts as (
  select
    j_1.id as job_id,
    r.total,
    r.lines,
    r.unresolved,
    r.uncosted
  from public.jobs j_1
  left join lateral (
    select
      coalesce(sum(x.line_cost) filter (where x.resolved and x.line_cost is not null), 0)::numeric(10,2) as total,
      count(*)::integer as lines,
      count(*) filter (where not x.resolved)::integer as unresolved,
      count(*) filter (where x.resolved and x.line_cost is null)::integer as uncosted
    from public.resolve_job_parts(j_1.id) x
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
  -- Was coalesce(payout_amount, 0). The blank is the point.
  j.payout_amount::numeric(10,2) as installer_pay,
  -- Only the rows carrying a stamped cost. A row stamped null is counted in
  -- uncosted_parts_lines instead, where it cannot be mistaken for free.
  coalesce(p.parts_cost, 0)::numeric(10,2) as parts_cost,
  coalesce(p.parts_count, 0)::integer as parts_count,
  case
    when j.parts_deducted_at is null and coalesce(pt.lines, 0) > 0 then pt.total
    else null::numeric
  end as expected_parts_cost,
  coalesce(pt.unresolved, 0) as unresolved_lines,
  b.parts_basis as parts_cost_basis,
  case
    when j.parts_deducted_at is not null then coalesce(p.parts_cost, 0)::numeric(10,2)
    when coalesce(pt.lines, 0) = 0 then null::numeric
    else pt.total
  end as parts_cost_effective,
  case
    when j.payout_amount is null then null::numeric
    when b.parts_basis = 'actual' then (j.sale_price - coalesce(p.parts_cost, 0) - j.payout_amount)::numeric(10,2)
    when b.parts_basis = 'expected' then (j.sale_price - pt.total - j.payout_amount)::numeric(10,2)
    else null::numeric
  end as margin,
  case
    when j.sale_price is null or j.sale_price = 0 then null::numeric
    when j.payout_amount is null then null::numeric
    when b.parts_basis = 'actual'
      then round((j.sale_price - coalesce(p.parts_cost, 0) - j.payout_amount) * 100.0 / j.sale_price, 1)
    when b.parts_basis = 'expected'
      then round((j.sale_price - pt.total - j.payout_amount) * 100.0 / j.sale_price, 1)
    else null::numeric
  end as margin_pct,
  j.address,
  j.phone,
  j.scheduled_date,
  j.time_window,
  j.installer_id,
  ins.name as installer_name,
  j.helper_id,
  hlp.name as helper_name,
  j.customer_email,
  j.agreement_status,
  j.agreement_signed_url,
  ag.id as agreement_id,
  ag.sent_at as agreement_sent_at,
  ag.completed_at as agreement_completed_at,
  ag.audit_log_url as agreement_audit_log_url,
  ag.last_error as agreement_last_error,
  ag.send_count as agreement_send_count,
  j.ro_type,
  wo.id as work_order_id,
  wo.status as work_order_status,
  wo.sent_at as work_order_sent_at,
  wo.completed_at as work_order_completed_at,
  wo.signed_document_url as work_order_signed_url,
  wo.audit_log_url as work_order_audit_log_url,
  wo.last_error as work_order_last_error,
  wo.send_count as work_order_send_count,
  ins.email as installer_email,
  j.site_conditions,
  coalesce(ag.view_count, 0) as agreement_view_count,
  coalesce(wo.view_count, 0) as work_order_view_count,
  j.nag_snoozed_until,
  coalesce(d.deposits_taken, 0)::numeric(10,2) as deposits_taken,
  coalesce(d.deposit_count, 0)::integer as deposit_count,
  d.last_deposit_on,
  (coalesce(j.sale_price, 0) - coalesce(d.deposits_taken, 0))::numeric(10,2) as balance_due,
  coalesce(jp.line_count, bs.line_count, 0)::integer as template_line_count,
  j.collected_by,
  j.valve_type,
  j.payment_type,
  j.water_source,
  j.notes,
  j.payout_amount,
  jp.line_count is not null as has_job_parts,
  j.deposit_amount,
  case
    when j.deposit_amount is null then null::numeric
    else greatest(j.deposit_amount - coalesce(d.deposits_taken, 0), 0)::numeric(10,2)
  end as deposit_outstanding,
  j.is_test,
  j.sold_at,
  j.quote_sent_at,
  j.quote_sent_count,
  -- The three new ones.
  j.payout_amount is not null as pay_known,
  case
    when j.parts_deducted_at is not null then coalesce(p.uncosted_txns, 0)
    else coalesce(pt.uncosted, 0)
  end as uncosted_parts_lines,
  case
    when b.parts_basis in ('none', 'partial', 'unpriced') then b.parts_basis
    when j.payout_amount is null then 'no_pay'
    else b.parts_basis
  end as profit_basis
from public.jobs j
  left join parts pt on pt.job_id = j.id
  left join public.installers ins on ins.id = j.installer_id
  left join public.installers hlp on hlp.id = j.helper_id
  left join public.agreements ag on ag.job_id = j.id and ag.type = 'customer_install'
  left join public.agreements wo on wo.job_id = j.id and wo.type = 'subcontractor_service'
  left join (
    select
      t.job_id,
      sum((- t.quantity)::numeric * t.unit_cost_at_txn) filter (where t.unit_cost_at_txn is not null) as parts_cost,
      sum(- t.quantity) as parts_count,
      count(*) filter (where t.unit_cost_at_txn is null)::integer as uncosted_txns
    from public.inventory_transactions t
    where t.job_id is not null
    group by t.job_id
  ) p on p.job_id = j.id
  left join (
    select job_deposits.job_id,
      sum(job_deposits.amount) as deposits_taken,
      count(*) as deposit_count,
      max(job_deposits.received_on) as last_deposit_on
    from public.job_deposits
    group by job_deposits.job_id
  ) d on d.job_id = j.id
  left join (
    select template_lines.template_id, count(*) as line_count
    from public.template_lines
    group by template_lines.template_id
  ) bs on bs.template_id = j.template_id
  left join (
    select job_parts.job_id, count(*) as line_count
    from public.job_parts
    group by job_parts.job_id
  ) jp on jp.job_id = j.id
  left join lateral (
    select case
      when j.parts_deducted_at is not null then
        case when coalesce(p.uncosted_txns, 0) > 0 then 'unpriced' else 'actual' end
      when coalesce(pt.lines, 0) = 0 then 'none'
      when coalesce(pt.unresolved, 0) > 0 then 'partial'
      when coalesce(pt.uncosted, 0) > 0 then 'unpriced'
      else 'expected'
    end as parts_basis
  ) b on true;

-- 5. pnl_monthly gains the two caveats.
--
-- The sums deliberately keep going. A month is a hundred numbers and one job
-- with no payout should not blank it. What it must not do is stay silent, so
-- the counts travel with the figures and the page prints them.

create or replace view public.pnl_monthly
with (security_invoker = true) as
with job_months as (
  select
    date_trunc('month', coalesce(m.install_date, m.created_at::date))::date as month,
    sum(m.sale_price) as revenue,
    sum(m.parts_cost) as parts_cost,
    coalesce(sum(m.installer_pay), 0) as installer_pay,
    sum(greatest(m.balance_due, 0)) as balance_on_install,
    count(*) as job_count,
    count(*) filter (where m.payout_amount is null) as pay_unknown,
    count(*) filter (where coalesce(m.uncosted_parts_lines, 0) > 0) as parts_unknown
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
  (coalesce(j.revenue, 0) - coalesce(j.parts_cost, 0) - coalesce(j.installer_pay, 0))::numeric(12,2) as gross_profit,
  (coalesce(j.revenue, 0) - coalesce(j.parts_cost, 0) - coalesce(j.installer_pay, 0) - coalesce(x.expense_total, 0))::numeric(12,2) as net_profit,
  (coalesce(j.revenue, 0) - coalesce(j.parts_cost, 0) - coalesce(j.installer_pay, 0) - coalesce(x.expense_total, 0))::numeric(12,2) as net,
  coalesce(p.payments_in, 0)::numeric(12,2) as deposits_in,
  coalesce(p.payment_count, 0)::integer as deposit_count,
  coalesce(j.balance_on_install, 0)::numeric(12,2) as balance_on_install,
  coalesce(p.payments_in, 0)::numeric(12,2) as cash_in,
  coalesce(j.pay_unknown, 0)::integer as pay_unknown_jobs,
  coalesce(j.parts_unknown, 0)::integer as parts_unknown_jobs
from all_months a
  left join job_months j on j.month = a.month
  left join expense_months x on x.month = a.month
  left join payment_months p on p.month = a.month;

-- 6. The install itself reports what it could not cost.
--
-- The deduction already stamped null when the item had no cost, because
-- max(unit_cost) over a null is null. What it did not do was say so: the
-- notice added those rows in as zero and announced a parts figure that was
-- too low. Same signature, same work, one more number in the answer.

create or replace function public.mark_job_installed(
  p_job_id uuid,
  p_install_date date default null,
  p_installer text default null,
  p_payout numeric default null
)
returns json
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_job        public.jobs%rowtype;
  v_template_id uuid;
  v_override   boolean;
  v_batch      int;
  v_unresolved text;
  v_inserted   int;
  v_cost       numeric;
  v_uncosted   int;
begin
  if p_job_id is null then
    raise exception 'No job was given to install.' using errcode = 'WB001';
  end if;

  if p_payout is not null and p_payout < 0 then
    raise exception 'Installer pay cannot be negative.' using errcode = 'WB009';
  end if;

  select exists (select 1 from public.job_parts jp where jp.job_id = p_job_id)
    into v_override;

  update public.jobs
  set status             = 'installed',
      install_date       = coalesce(p_install_date, install_date, current_date),
      installer          = coalesce(nullif(btrim(p_installer), ''), installer),
      payout_amount      = coalesce(p_payout, payout_amount),
      parts_deducted_at  = now(),
      parts_deduct_batch = parts_deduct_batch + 1
  where id = p_job_id
    and parts_deducted_at is null
  returning * into v_job;

  if not found then
    select * into v_job from public.jobs where id = p_job_id;

    if not found then
      raise exception 'That job no longer exists. Reload the jobs list.' using errcode = 'WB001';
    end if;

    raise exception 'This job was already installed on % and its parts were already deducted. Reverse the install first if you need to redo it.',
      to_char(v_job.parts_deducted_at, 'Mon FMDD, YYYY at FMHH12:MI AM')
      using errcode = 'WB002';
  end if;

  v_batch := v_job.parts_deduct_batch;

  if not v_override then
    v_template_id := coalesce(
      v_job.template_id,
      (select t.id from public.system_templates t where t.label = v_job.system_template)
    );

    if v_template_id is null then
      raise exception 'No system template named "%" exists, so this job has no parts list. Create the template first, or list this job''s parts against the job itself.',
        v_job.system_template
        using errcode = 'WB003';
    end if;

    if v_job.template_id is distinct from v_template_id then
      update public.jobs set template_id = v_template_id where id = p_job_id;
    end if;
  end if;

  select string_agg(
           format('%s line for %s', r.line_type, coalesce(r.pick_category, 'unknown category')),
           ', ')
    into v_unresolved
  from public.resolve_job_parts(p_job_id) r
  where not r.resolved;

  if v_unresolved is not null then
    raise exception 'Nothing was deducted. These template lines have no matching inventory item for the choices on this job, finish "%", RO type "%" and valve type "%": %.',
      coalesce(nullif(btrim(v_job.faucet_finish), ''), 'none selected'),
      coalesce(nullif(btrim(v_job.ro_type), ''), 'none selected'),
      coalesce(nullif(btrim(v_job.valve_type), ''), 'none selected'),
      v_unresolved
      using errcode = 'WB004';
  end if;

  insert into public.inventory_transactions
    (item_id, quantity, txn_type, job_id, unit_cost_at_txn, reference, note, source, deduct_batch)
  select
    r.item_id,
    (-sum(r.quantity))::int,
    'install',
    p_job_id,
    max(r.unit_cost),
    v_job.invoice_number,
    case when v_override
      then 'Auto deduct from this job''s own parts list'
      else format('Auto deduct from template %s', v_job.system_template)
    end,
    case when v_override then 'job_parts' else 'template' end,
    v_batch
  from public.resolve_job_parts(p_job_id) r
  group by r.item_id;

  get diagnostics v_inserted = row_count;

  select
    coalesce(sum(-t.quantity * t.unit_cost_at_txn) filter (where t.unit_cost_at_txn is not null), 0),
    count(*) filter (where t.unit_cost_at_txn is null)
    into v_cost, v_uncosted
  from public.inventory_transactions t
  where t.job_id = p_job_id;

  return json_build_object(
    'job_id',         p_job_id,
    'batch',          v_batch,
    'lines_deducted', v_inserted,
    'parts_cost',     v_cost,
    'uncosted_lines', v_uncosted,
    'template',       case when v_override then 'this job''s own parts list' else v_job.system_template end,
    'from_job_parts', v_override
  );
end;
$function$;

-- 7. Checks.

do $$
declare
  v_installed_pay int;
  v_margin_with_no_pay int;
  v_valves int;
  v_basis text;
begin
  -- The two valves are zero on purpose and must stay costable. If this fails,
  -- a deliberate zero has been turned into an unknown somewhere.
  select count(*) into v_valves
  from public.inventory_items where unit_cost = 0;
  if v_valves <> 2 then
    raise exception 'expected the 2 zero cost valves, found %', v_valves;
  end if;

  -- No job may show a profit while its payout is unknown.
  select count(*) into v_margin_with_no_pay
  from public.job_margin where payout_amount is null and margin is not null;
  if v_margin_with_no_pay > 0 then
    raise exception '% jobs still show a profit with no payout recorded', v_margin_with_no_pay;
  end if;

  -- Pay reads through unchanged where it is known.
  select count(*) into v_installed_pay
  from public.job_margin m join public.jobs j on j.id = m.id
  where j.payout_amount is not null and m.installer_pay is distinct from j.payout_amount::numeric(10,2);
  if v_installed_pay > 0 then
    raise exception '% jobs disagree with their own payout column', v_installed_pay;
  end if;

  -- And the basis of a fully costed job is unchanged by any of this.
  select parts_cost_basis into v_basis
  from public.job_margin
  where status = 'installed' and uncosted_parts_lines = 0
  limit 1;
  if v_basis is distinct from 'actual' then
    raise exception 'an installed, fully costed job reads as % rather than actual', v_basis;
  end if;
end $$;

notify pgrst, 'reload schema';
