-- valve_type: the control valve tracked as its own item, chosen per job.
--
-- Every whole home system ships with a control valve, and until now the valve
-- was invisible inside the system SKU. Which type is on the shelf could not be
-- counted, and an installer could not be told which one to take. This splits
-- it out as a third customer pick source, built exactly as faucet_finish and
-- ro_type were: a column on the job, a managed list, a branch in
-- resolve_template_parts, and a pick line on the build sheets that need one.
--
-- The valve items cost zero on purpose. The valve is already inside the landed
-- cost of each system SKU, so pricing it again would count it twice in every
-- margin. These rows exist to say which type is on the shelf, not to cost a
-- job. Because they cost nothing, the opening counts and every deduction land
-- in the ledger at zero and no margin moves.
--
-- resolve_template_parts gains p_valve_type. plpgsql binds a call by argument
-- count, so every caller is re-declared to pass it; a caller left on the three
-- argument form would silently resolve nothing for a valve line. The three
-- argument form is dropped so it cannot be called by mistake.

-- ---------------------------------------------------------------------------
-- the job field
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists valve_type text;

-- ---------------------------------------------------------------------------
-- the managed list. widened rather than dropped, same as every list before it.
-- ---------------------------------------------------------------------------
alter table public.settings_options
  drop constraint if exists settings_options_list_key_check;

alter table public.settings_options
  add constraint settings_options_list_key_check
  check (list_key in (
    'inventory_category', 'service_city', 'faucet_finish', 'payment_type',
    'time_window', 'expense_category', 'ro_type', 'valve_type'));

insert into public.settings_options (list_key, value, sort_order)
select 'valve_type', v, (i * 10)
from unnest(array['Clack', 'Hankscraft']) with ordinality as t(v, i)
on conflict (list_key, value) do nothing;

-- ---------------------------------------------------------------------------
-- template_lines may now carry a valve_type pick. widened, not dropped: the
-- check is what stops a typo creating a pick line the resolver has no branch
-- for, which would silently never match.
-- ---------------------------------------------------------------------------
alter table public.template_lines
  drop constraint if exists template_lines_pick_source_check;

alter table public.template_lines
  add constraint template_lines_pick_source_check
  check (pick_source is null or pick_source in ('faucet_finish', 'ro_type', 'valve_type'));

-- ---------------------------------------------------------------------------
-- the two valve items, one per type. The variant is what the pick matches on.
-- Guarded by sku, so re-running is a no op.
-- ---------------------------------------------------------------------------
insert into public.inventory_items
  (sku, name, category, variant, unit_cost, reorder_threshold, active, notes)
values
  ('VLV-CLACK', 'Clack control valve', 'Valve', 'Clack', 0, 2, true,
   'Costed at zero on purpose. The valve is inside the landed cost of each '
   'system SKU, so pricing it here would count it twice. Tracks which type is '
   'on the shelf.'),
  ('VLV-HANK', 'Hankscraft control valve', 'Valve', 'Hankscraft', 0, 2, true,
   'Costed at zero on purpose. The valve is inside the landed cost of each '
   'system SKU, so pricing it here would count it twice. Tracks which type is '
   'on the shelf.')
on conflict (sku) do nothing;

-- ---------------------------------------------------------------------------
-- opening counts, as purchases at zero cost, dated the day this runs.
-- Guarded by reference so a second run cannot double the shelf.
-- ---------------------------------------------------------------------------
insert into public.inventory_transactions
  (item_id, quantity, txn_type, unit_cost_at_txn, reference, note, location, source)
select
  i.id,
  v.qty,
  'purchase',
  0,
  'opening count, split from system SKUs',
  'Opening count on the day the control valve was split out of the system SKUs. '
  'Zero cost, because the valve is already inside the landed cost of each system.',
  'Unit 4030',
  'manual'
from (values ('VLV-CLACK', 5), ('VLV-HANK', 2)) as v(sku, qty)
join public.inventory_items i on i.sku = v.sku
where not exists (
  select 1 from public.inventory_transactions t
  where t.item_id = i.id
    and t.reference = 'opening count, split from system SKUs'
);

-- ---------------------------------------------------------------------------
-- teach the usage counter about the new list
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
    when 'ro_type' then
      (select count(*) from public.jobs where ro_type = p_value)
    when 'valve_type' then
      (select count(*) from public.jobs where valve_type = p_value)
    else 0
  end)::int
$usage$;

-- ---------------------------------------------------------------------------
-- resolve_template_parts gains p_valve_type
-- ---------------------------------------------------------------------------
drop function if exists public.resolve_template_parts(uuid, text, text);

create or replace function public.resolve_template_parts(
  p_template_id   uuid,
  p_faucet_finish text default null,
  p_ro_type       text default null,
  p_valve_type    text default null
)
returns table (
  line_id       uuid,
  line_type     text,
  pick_source   text,
  pick_category text,
  quantity      int,
  item_id       uuid,
  sku           text,
  item_name     text,
  item_variant  text,
  unit_cost     numeric,
  line_cost     numeric,
  resolved      boolean,
  sort_order    int
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $resolve$
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
    (tl.quantity * coalesce(fixed_item.unit_cost, pick.unit_cost, 0))::numeric(10,2),
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
  order by tl.sort_order, tl.id
$resolve$;

grant execute on function public.resolve_template_parts(uuid, text, text, text) to authenticated;
revoke execute on function public.resolve_template_parts(uuid, text, text, text) from public, anon;

-- ---------------------------------------------------------------------------
-- the four callers, re-declared to pass the third pick value. Bodies are
-- unchanged apart from that argument and, in mark_job_installed, an error
-- message that now names all three choices.
-- ---------------------------------------------------------------------------
create or replace function public.mark_job_installed(
  p_job_id uuid,
  p_install_date date default null,
  p_installer text default null,
  p_payout numeric default null
)
returns json
language plpgsql
set search_path = public, pg_temp
as $install$
declare
  v_job         public.jobs%rowtype;
  v_template_id uuid;
  v_batch       int;
  v_unresolved  text;
  v_inserted    int;
  v_cost        numeric;
begin
  if p_job_id is null then
    raise exception 'No job was given to install.' using errcode = 'WB001';
  end if;

  if p_payout is not null and p_payout < 0 then
    raise exception 'Installer pay cannot be negative.' using errcode = 'WB009';
  end if;

  -- claim the deduction and lock the row in one statement. a second caller
  -- waits here, then finds parts_deducted_at already set and gets no row.
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

  v_template_id := coalesce(
    v_job.template_id,
    (select t.id from public.system_templates t where t.label = v_job.system_template)
  );

  if v_template_id is null then
    raise exception 'No system template named "%" exists, so this job has no parts list. Create the template first.',
      v_job.system_template
      using errcode = 'WB003';
  end if;

  -- keep the link when the job predates template_id and matched by label
  if v_job.template_id is distinct from v_template_id then
    update public.jobs set template_id = v_template_id where id = p_job_id;
  end if;

  -- a partial deduction is worse than none, so refuse the whole thing
  select string_agg(
           format('%s line for %s', r.line_type, coalesce(r.pick_category, 'unknown category')),
           ', ')
    into v_unresolved
  from public.resolve_template_parts(
         v_template_id, v_job.faucet_finish, v_job.ro_type, v_job.valve_type) r
  where not r.resolved;

  if v_unresolved is not null then
    raise exception 'Nothing was deducted. These template lines have no matching inventory item for the choices on this job, finish "%", RO type "%" and valve type "%": %.',
      coalesce(nullif(btrim(v_job.faucet_finish), ''), 'none selected'),
      coalesce(nullif(btrim(v_job.ro_type), ''), 'none selected'),
      coalesce(nullif(btrim(v_job.valve_type), ''), 'none selected'),
      v_unresolved
      using errcode = 'WB004';
  end if;

  -- one row per distinct item. a template that lists the same item twice is
  -- summed rather than written twice, which keeps the unique index happy.
  insert into public.inventory_transactions
    (item_id, quantity, txn_type, job_id, unit_cost_at_txn, reference, note, source, deduct_batch)
  select
    r.item_id,
    (-sum(r.quantity))::int,
    'install',
    p_job_id,
    max(r.unit_cost),
    v_job.invoice_number,
    format('Auto deduct from template %s', v_job.system_template),
    'template',
    v_batch
  from public.resolve_template_parts(
         v_template_id, v_job.faucet_finish, v_job.ro_type, v_job.valve_type) r
  group by r.item_id;

  get diagnostics v_inserted = row_count;

  select coalesce(sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)), 0)
    into v_cost
  from public.inventory_transactions t
  where t.job_id = p_job_id;

  return json_build_object(
    'job_id',         p_job_id,
    'batch',          v_batch,
    'lines_deducted', v_inserted,
    'parts_cost',     v_cost,
    'template',       v_job.system_template
  );
end;
$install$;

create or replace function public.sync_job_reservations(p_job_id uuid)
returns json
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_job         public.jobs%rowtype;
  v_template_id uuid;
  v_released    int := 0;
  v_open        int := 0;
  v_units       int := 0;
  v_unresolved  int := 0;
begin
  if p_job_id is null then
    raise exception 'No job was given to reserve parts for.' using errcode = 'WB012';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;

  if not found then
    raise exception 'That job no longer exists, so its reservations cannot be updated.'
      using errcode = 'WB012';
  end if;

  if v_job.status in ('installed', 'cancelled') or v_job.parts_deducted_at is not null then
    update public.job_reservations
    set released_at     = now(),
        released_reason = case when v_job.status = 'cancelled' then 'cancelled' else 'installed' end
    where job_id = p_job_id
      and released_at is null;

    get diagnostics v_released = row_count;

    return json_build_object(
      'job_id', p_job_id, 'template_id', null, 'open_lines', 0,
      'released_lines', v_released, 'units_committed', 0, 'unresolved_lines', 0
    );
  end if;

  -- No date, no claim.
  if v_job.scheduled_date is null then
    update public.job_reservations
    set released_at     = now(),
        released_reason = 'unscheduled'
    where job_id = p_job_id
      and released_at is null;

    get diagnostics v_released = row_count;

    return json_build_object(
      'job_id', p_job_id, 'template_id', null, 'open_lines', 0,
      'released_lines', v_released, 'units_committed', 0, 'unresolved_lines', 0
    );
  end if;

  -- Named but not linked. This used to resolve silently by label.
  if v_job.template_id is null
     and exists (select 1 from public.system_templates t where t.label = v_job.system_template)
  then
    raise exception
      'This job names the build sheet "%" but is not linked to it, so its parts '
      'would be claimed and could never be printed on a work order. Set the '
      'template on the job rather than only its name.',
      v_job.system_template
      using errcode = 'WB012';
  end if;

  v_template_id := v_job.template_id;

  if v_template_id is null then
    update public.job_reservations
    set released_at     = now(),
        released_reason = 'template_changed'
    where job_id = p_job_id
      and released_at is null;

    get diagnostics v_released = row_count;

    return json_build_object(
      'job_id', p_job_id, 'template_id', null, 'open_lines', 0,
      'released_lines', v_released, 'units_committed', 0, 'unresolved_lines', 0
    );
  end if;

  with wanted as (
    select r.item_id, sum(r.quantity)::int as quantity
    from public.resolve_template_parts(
           v_template_id, v_job.faucet_finish, v_job.ro_type, v_job.valve_type) r
    where r.resolved and r.item_id is not null
    group by r.item_id
  ),
  released as (
    update public.job_reservations jr
    set released_at     = now(),
        released_reason = 'template_changed'
    where jr.job_id = p_job_id
      and jr.released_at is null
      and not exists (select 1 from wanted w where w.item_id = jr.item_id)
    returning 1
  ),
  upserted as (
    insert into public.job_reservations (job_id, item_id, quantity)
    select p_job_id, w.item_id, w.quantity
    from wanted w
    on conflict (job_id, item_id) where released_at is null
    do update set quantity = excluded.quantity
    returning 1
  )
  select count(*)::int into v_released from released;

  select count(*)::int, coalesce(sum(jr.quantity), 0)::int
    into v_open, v_units
  from public.job_reservations jr
  where jr.job_id = p_job_id and jr.released_at is null;

  select count(*)::int into v_unresolved
  from public.resolve_template_parts(
         v_template_id, v_job.faucet_finish, v_job.ro_type, v_job.valve_type) r
  where not r.resolved;

  return json_build_object(
    'job_id', p_job_id, 'template_id', v_template_id, 'open_lines', v_open,
    'released_lines', v_released, 'units_committed', v_units,
    'unresolved_lines', v_unresolved
  );
end;
$fn$;

create or replace function public.job_schedule_conflicts(p_job_id uuid)
returns table (
  item_id         uuid,
  sku             text,
  item_name       text,
  required        integer,
  on_hand         integer,
  committed_other integer,
  available_other integer,
  shortfall       integer,
  competing_jobs  json
)
language plpgsql
stable
set search_path = public, pg_temp
as $conflicts$
declare
  v_job         public.jobs%rowtype;
  v_template_id uuid;
begin
  if p_job_id is null then
    raise exception 'No job was given to check for scheduling conflicts.' using errcode = 'WB016';
  end if;

  select * into v_job from public.jobs where id = p_job_id;

  if not found then
    raise exception 'That job no longer exists, so its parts cannot be checked. Reload the list.'
      using errcode = 'WB016';
  end if;

  if v_job.status in ('installed', 'cancelled') or v_job.parts_deducted_at is not null then
    return;
  end if;

  v_template_id := coalesce(
    v_job.template_id,
    (select t.id from public.system_templates t where t.label = v_job.system_template)
  );

  if v_template_id is null then
    return;
  end if;

  return query
  with needed as (
    select r.item_id as need_item_id, sum(r.quantity)::int as required
    from public.resolve_template_parts(
           v_template_id, v_job.faucet_finish, v_job.ro_type, v_job.valve_type) r
    where r.resolved and r.item_id is not null
    group by r.item_id
  ),
  stock as (
    select tx.item_id as stock_item_id, sum(tx.quantity)::int as on_hand
    from public.inventory_transactions tx
    group by tx.item_id
  ),
  others as (
    select jr.item_id as other_item_id, sum(jr.quantity)::int as committed_other
    from public.job_reservations jr
    where jr.released_at is null
      and jr.job_id <> p_job_id
    group by jr.item_id
  )
  select
    n.need_item_id,
    i.sku,
    i.name,
    n.required,
    coalesce(s.on_hand, 0),
    coalesce(o.committed_other, 0),
    (coalesce(s.on_hand, 0) - coalesce(o.committed_other, 0)),
    (n.required - (coalesce(s.on_hand, 0) - coalesce(o.committed_other, 0))),
    coalesce((
      select json_agg(competing.c)
      from (
        select json_build_object(
          'job_id',         oj.id,
          'customer_name',  oj.customer_name,
          'quantity',       ojr.quantity,
          'status',         oj.status,
          'scheduled_date', oj.scheduled_date
        ) as c
        from public.job_reservations ojr
        join public.jobs oj on oj.id = ojr.job_id
        where ojr.item_id = n.need_item_id
          and ojr.released_at is null
          and ojr.job_id <> p_job_id
        order by oj.scheduled_date nulls last, oj.customer_name
      ) competing
    ), '[]'::json)
  from needed n
  join public.inventory_items i on i.id = n.need_item_id
  left join stock  s on s.stock_item_id = n.need_item_id
  left join others o on o.other_item_id = n.need_item_id
  where n.required > (coalesce(s.on_hand, 0) - coalesce(o.committed_other, 0))
  order by (n.required - (coalesce(s.on_hand, 0) - coalesce(o.committed_other, 0))) desc, i.name;
end;
$conflicts$;

create or replace function public.job_schedule_readiness(p_job_ids uuid[])
returns table (
  job_id           uuid,
  checked          boolean,
  has_sheet        boolean,
  sheet_lines      integer,
  unresolved_lines integer,
  short_items      integer,
  short_units      integer
)
language plpgsql
stable
set search_path = public, pg_temp
as $readiness$
begin
  if p_job_ids is null or array_length(p_job_ids, 1) is null then
    return;
  end if;

  return query
  select
    j.id,
    (j.status not in ('installed', 'cancelled') and j.parts_deducted_at is null),
    (j.template_id is not null),
    coalesce(t.lines, 0),
    coalesce(u.unresolved, 0),
    coalesce(c.items, 0),
    coalesce(c.units, 0)
  from public.jobs j
  left join lateral (
    select
      count(*)::int                                   as items,
      coalesce(sum(greatest(k.shortfall, 0)), 0)::int as units
    from public.job_schedule_conflicts(j.id) k
  ) c on true
  left join lateral (
    select count(*)::int as unresolved
    from public.resolve_template_parts(
           j.template_id, j.faucet_finish, j.ro_type, j.valve_type) r
    where not r.resolved
  ) u on true
  left join lateral (
    select count(*)::int as lines
    from public.template_lines tl
    where tl.template_id = j.template_id
  ) t on true
  where j.id = any(p_job_ids);
end;
$readiness$;

-- ---------------------------------------------------------------------------
-- job_margin gains valve_type, appended, so the job modal and the send
-- function read it from the same view as every other choice.
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
      (j.sale_price - coalesce(p.parts_cost, 0) - coalesce(j.payout_amount, 0)) * 100.0 / j.sale_price, 1)
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
  -- the build sheet
  coalesce(bs.line_count, 0)::int as template_line_count,
  j.collected_by,
  j.valve_type
from public.jobs j
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
) bs on bs.template_id = j.template_id;

-- ---------------------------------------------------------------------------
-- the pick line on every build sheet that installs a whole home system.
-- RO Only has no control valve and gets nothing. Guarded by the unique pick
-- source per template, so re-running adds nothing.
-- ---------------------------------------------------------------------------
insert into public.template_lines
  (template_id, line_type, pick_source, pick_category, quantity, sort_order, note)
select
  t.id, 'customer_pick', 'valve_type', 'Valve', 1, 110,
  'Control valve, by the type chosen on the job. Costed at zero: the valve is '
  'already inside the landed cost of the system.'
from public.system_templates t
where t.label in ('Flagship Bundle', 'Softener Only', 'Well Water Bundle')
  and not exists (
    select 1 from public.template_lines l
    where l.template_id = t.id
      and l.line_type = 'customer_pick'
      and l.pick_source = 'valve_type'
  );

-- ---------------------------------------------------------------------------
-- prove it, so a broken migration cannot apply quietly
-- ---------------------------------------------------------------------------
do $$
declare
  v_clack     int;
  v_hank      int;
  v_sheets    int;
  v_lines     int;
  v_ro_lines  int;
  v_resolved  text;
  v_flagship  uuid;
begin
  -- the shelf reads the opening counts, and only the opening counts
  select on_hand into v_clack from public.inventory_stock where sku = 'VLV-CLACK';
  select on_hand into v_hank  from public.inventory_stock where sku = 'VLV-HANK';

  if v_clack is distinct from 5 or v_hank is distinct from 2 then
    raise exception 'valve opening counts did not land: Clack %, Hankscraft %', v_clack, v_hank;
  end if;

  -- every whole home sheet that exists here carries the line, and RO Only does not
  select count(*) into v_sheets
  from public.system_templates t
  where t.label in ('Flagship Bundle', 'Softener Only', 'Well Water Bundle');

  select count(*) into v_lines
  from public.template_lines l
  join public.system_templates t on t.id = l.template_id
  where l.pick_source = 'valve_type'
    and t.label in ('Flagship Bundle', 'Softener Only', 'Well Water Bundle');

  if v_lines <> v_sheets then
    raise exception 'expected a valve line on % sheets, found %', v_sheets, v_lines;
  end if;

  select count(*) into v_ro_lines
  from public.template_lines l
  join public.system_templates t on t.id = l.template_id
  where l.pick_source = 'valve_type' and t.label = 'RO Only';

  if v_ro_lines <> 0 then
    raise exception 'RO Only must not carry a valve line';
  end if;

  -- the resolver answers the new pick
  select id into v_flagship from public.system_templates where label = 'Flagship Bundle';

  if v_flagship is not null then
    select r.sku into v_resolved
    from public.resolve_template_parts(v_flagship, 'Chrome', 'Tank Style', 'Clack') r
    where r.pick_source = 'valve_type';

    if v_resolved is distinct from 'VLV-CLACK' then
      raise exception 'a Clack pick resolved to % rather than VLV-CLACK', coalesce(v_resolved, 'nothing');
    end if;

    select r.sku into v_resolved
    from public.resolve_template_parts(v_flagship, 'Chrome', 'Tank Style', 'Hankscraft') r
    where r.pick_source = 'valve_type';

    if v_resolved is distinct from 'VLV-HANK' then
      raise exception 'a Hankscraft pick resolved to % rather than VLV-HANK', coalesce(v_resolved, 'nothing');
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
