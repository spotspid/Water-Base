-- ro_type: a second customer pick source, built the same way as faucet finish.
--
-- A pick line defers one part to a choice made on the job. faucet_finish was
-- the only source, so resolve_template_parts took the finish as its one extra
-- argument. A second source means a second argument, which means the three
-- functions that call it have to be re-declared to pass it. plpgsql binds a
-- call by argument count at run time, so a caller left on the two argument
-- form would silently resolve nothing for an ro_type line.
--
-- The match is on inventory_items.variant, exactly as finishes are. The two RO
-- units arrived with no variant, so they are given one here. Without that
-- there is nothing for the choice to match against.

-- ---------------------------------------------------------------------------
-- the job field
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists ro_type text;

-- ---------------------------------------------------------------------------
-- the managed list. widened rather than dropped, same as every list before it.
-- ---------------------------------------------------------------------------
alter table public.settings_options
  drop constraint if exists settings_options_list_key_check;

alter table public.settings_options
  add constraint settings_options_list_key_check
  check (list_key in (
    'inventory_category', 'service_city', 'faucet_finish', 'payment_type',
    'time_window', 'expense_category', 'ro_type'));

insert into public.settings_options (list_key, value, sort_order)
select 'ro_type', v, (i * 10)
from unnest(array['Tank Style', 'Tankless']) with ordinality as t(v, i)
on conflict (list_key, value) do nothing;

-- ---------------------------------------------------------------------------
-- template_lines pinned pick_source to the single source that existed. widen
-- it rather than drop it: it is what stops a typo creating a pick line that
-- resolve_template_parts has no branch for, and so would silently never match.
-- ---------------------------------------------------------------------------
alter table public.template_lines
  drop constraint if exists template_lines_pick_source_check;

alter table public.template_lines
  add constraint template_lines_pick_source_check
  check (pick_source is null or pick_source in ('faucet_finish', 'ro_type'));

-- ---------------------------------------------------------------------------
-- give the two RO units the variant the choice matches on.
--
-- guarded by sku, so this is a no op on an environment where the opening
-- inventory has not been loaded.
-- ---------------------------------------------------------------------------
update public.inventory_items set variant = 'Tank Style'
where sku = 'RO-TANK-5ST' and variant is distinct from 'Tank Style';

update public.inventory_items set variant = 'Tankless'
where sku = 'RO-TL-ALK800' and variant is distinct from 'Tankless';

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
    else 0
  end)::int
$usage$;

-- ---------------------------------------------------------------------------
-- resolve_template_parts gains p_ro_type.
--
-- the two argument form is dropped rather than left beside this one, because
-- an exact two argument match would win over this function's default and a
-- stale caller would keep resolving nothing.
-- ---------------------------------------------------------------------------
drop function if exists public.resolve_template_parts(uuid, text);

create or replace function public.resolve_template_parts(
  p_template_id uuid,
  p_faucet_finish text default null,
  p_ro_type text default null
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
                      end
    order by i.created_at, i.id
    limit 1
  ) pick on true
  where tl.template_id = p_template_id
  order by tl.sort_order, tl.id
$resolve$;

-- ---------------------------------------------------------------------------
-- the three callers, re-declared to pass the second pick value.
-- bodies are unchanged apart from that argument and, in mark_job_installed,
-- an error message that now names both choices rather than only the finish.
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
  from public.resolve_template_parts(v_template_id, v_job.faucet_finish, v_job.ro_type) r
  where not r.resolved;

  if v_unresolved is not null then
    raise exception 'Nothing was deducted. These template lines have no matching inventory item for the choices on this job, finish "%" and RO type "%": %.',
      coalesce(nullif(btrim(v_job.faucet_finish), ''), 'none selected'),
      coalesce(nullif(btrim(v_job.ro_type), ''), 'none selected'),
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
  from public.resolve_template_parts(v_template_id, v_job.faucet_finish, v_job.ro_type) r
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
as $sync$
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
      'job_id',           p_job_id,
      'template_id',      null,
      'open_lines',       0,
      'released_lines',   v_released,
      'units_committed',  0,
      'unresolved_lines', 0
    );
  end if;

  v_template_id := coalesce(
    v_job.template_id,
    (select t.id from public.system_templates t where t.label = v_job.system_template)
  );

  if v_template_id is null then
    update public.job_reservations
    set released_at     = now(),
        released_reason = 'template_changed'
    where job_id = p_job_id
      and released_at is null;

    get diagnostics v_released = row_count;

    return json_build_object(
      'job_id',           p_job_id,
      'template_id',      null,
      'open_lines',       0,
      'released_lines',   v_released,
      'units_committed',  0,
      'unresolved_lines', 0
    );
  end if;

  with wanted as (
    select r.item_id, sum(r.quantity)::int as quantity
    from public.resolve_template_parts(v_template_id, v_job.faucet_finish, v_job.ro_type) r
    where r.resolved
      and r.item_id is not null
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
  where jr.job_id = p_job_id
    and jr.released_at is null;

  select count(*)::int
    into v_unresolved
  from public.resolve_template_parts(v_template_id, v_job.faucet_finish, v_job.ro_type) r
  where not r.resolved;

  return json_build_object(
    'job_id',           p_job_id,
    'template_id',      v_template_id,
    'open_lines',       v_open,
    'released_lines',   v_released,
    'units_committed',  v_units,
    'unresolved_lines', v_unresolved
  );
end;
$sync$;

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
    from public.resolve_template_parts(v_template_id, v_job.faucet_finish, v_job.ro_type) r
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

-- ---------------------------------------------------------------------------
-- job_margin gains ro_type, appended, so the job detail can show the choice
-- without a second round trip.
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
  ag.id           as agreement_id,
  ag.sent_at      as agreement_sent_at,
  ag.completed_at as agreement_completed_at,
  ag.audit_log_url as agreement_audit_log_url,
  ag.last_error   as agreement_last_error,
  ag.send_count   as agreement_send_count,
  j.ro_type
from public.jobs j
left join public.installers ins on ins.id = j.installer_id
left join public.installers hlp on hlp.id = j.helper_id
left join public.agreements ag
  on ag.job_id = j.id and ag.type = 'customer_install'
left join (
  select
    t.job_id,
    sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)) as parts_cost,
    sum(-t.quantity)                                   as parts_count
  from public.inventory_transactions t
  where t.job_id is not null
  group by t.job_id
) p on p.job_id = j.id;

grant execute on function public.resolve_template_parts(uuid, text, text) to authenticated;
grant execute on function public.mark_job_installed(uuid, date, text, numeric) to authenticated;
grant execute on function public.sync_job_reservations(uuid) to authenticated;
grant execute on function public.job_schedule_conflicts(uuid) to authenticated;
grant execute on function public.settings_option_usage(text, text) to authenticated;

notify pgrst, 'reload schema';
