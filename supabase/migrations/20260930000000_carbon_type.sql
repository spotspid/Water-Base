-- Carbon type: standard or catalytic, chosen per job.
--
-- The Filtration Only sheet hard coded the plain carbon tank, so a customer
-- who wanted catalytic could not be quoted for one without a second sheet.
-- Catalytic costs $161.71 more, which is real money to leave out of a job's
-- parts cost.
--
-- It becomes a customer pick, the fourth one, alongside faucet finish, RO type
-- and valve type: the line names carbon_type, and resolve_template_parts
-- matches the inventory item whose variant equals the job's choice. Any sheet
-- can carry the line, so a catalytic option on a future sheet needs no code.
--
-- The two tanks move from the System category to a Carbon category. That is
-- what makes them the candidate set for the pick and nothing else: a pick
-- matches on category and variant together, and leaving them under System
-- would put every system tank in the running.
--
-- Every job on a sheet with a carbon line is given Standard, because that is
-- the tank those jobs were quoted and installed with. Without it their parts
-- would resolve to nothing the moment this lands.

-- ---------------------------------------------------------------------------
-- the option list
-- ---------------------------------------------------------------------------

alter table public.settings_options drop constraint if exists settings_options_list_key_check;
alter table public.settings_options
  add constraint settings_options_list_key_check
  check (list_key = any (array[
    'inventory_category', 'service_city', 'faucet_finish', 'payment_type',
    'time_window', 'expense_category', 'ro_type', 'valve_type', 'carbon_type'
  ]));

-- A pick line names the job field it resolves on, and the set was fixed at
-- three. The fourth goes in here as well, or the sheet below cannot carry it.
alter table public.template_lines drop constraint if exists template_lines_pick_source_check;
alter table public.template_lines
  add constraint template_lines_pick_source_check
  check (pick_source is null or pick_source = any (array[
    'faucet_finish', 'ro_type', 'valve_type', 'carbon_type'
  ]));

insert into public.settings_options (list_key, value, sort_order, active)
values ('carbon_type', 'Standard', 10, true),
       ('carbon_type', 'Catalytic', 20, true),
       ('inventory_category', 'Carbon', 145, true)
on conflict (list_key, value) do update set active = true;

-- ---------------------------------------------------------------------------
-- the two tanks become the candidates
-- ---------------------------------------------------------------------------

update public.inventory_items
set category = 'Carbon', variant = 'Standard'
where sku = 'CARB-ONLY-1054';

update public.inventory_items
set category = 'Carbon', variant = 'Catalytic'
where sku = 'CARB-CAT-1054';

-- ---------------------------------------------------------------------------
-- the choice on a job
-- ---------------------------------------------------------------------------

alter table public.jobs add column if not exists carbon_type text;

comment on column public.jobs.carbon_type is
  'Standard or Catalytic, for sheets carrying a carbon tank. Null on a job whose sheet has none.';

-- Every job on a sheet that has a carbon line was quoted the plain tank, so
-- that is what they get. Done before the line changes, so no job spends a
-- moment with an unresolved part.
update public.jobs j
set carbon_type = 'Standard'
where j.carbon_type is null
  and exists (
    select 1 from public.template_lines l
    join public.inventory_items i on i.id = l.item_id
    where l.template_id = j.template_id and i.sku like 'CARB%'
  );

-- ---------------------------------------------------------------------------
-- the resolver learns the fourth pick
-- ---------------------------------------------------------------------------

-- p_carbon_type is last and defaults to null, so every existing four argument
-- caller keeps working: the trigger in 20260922000000_no_ro.sql, and anything
-- else that resolves a sheet without a job in front of it.
create or replace function public.resolve_template_parts(
  p_template_id uuid,
  p_faucet_finish text default null,
  p_ro_type text default null,
  p_valve_type text default null,
  p_carbon_type text default null
)
returns table(line_id uuid, line_type text, pick_source text, pick_category text,
              quantity integer, item_id uuid, sku text, item_name text,
              item_variant text, unit_cost numeric, line_cost numeric,
              resolved boolean, sort_order integer)
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
                        when 'carbon_type'   then p_carbon_type
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

-- and passes the job's choice through
create or replace function public.resolve_job_parts(p_job_id uuid)
returns table(line_id uuid, line_type text, pick_source text, pick_category text,
              quantity integer, item_id uuid, sku text, item_name text,
              item_variant text, unit_cost numeric, line_cost numeric,
              resolved boolean, sort_order integer, source text)
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
      (jp.quantity * coalesce(i.unit_cost, 0))::numeric(10,2),
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
         v_job.template_id, v_job.faucet_finish, v_job.ro_type, v_job.valve_type,
         v_job.carbon_type) r;
end;
$function$;

-- ---------------------------------------------------------------------------
-- the sheet stops hard coding the tank
-- ---------------------------------------------------------------------------

update public.template_lines
set line_type = 'customer_pick',
    item_id = null,
    pick_source = 'carbon_type',
    pick_category = 'Carbon'
where template_id = (select id from public.system_templates where label = 'Filtration Only')
  and item_id = (select id from public.inventory_items where sku = 'CARB-ONLY-1054');

-- ---------------------------------------------------------------------------
-- proof
-- ---------------------------------------------------------------------------

do $$
declare
  v_tpl uuid;
  v_std numeric;
  v_cat numeric;
  v_lines integer;
  v_unresolved integer;
  v_job record;
begin
  select id into v_tpl from public.system_templates where label = 'Filtration Only';

  -- both choices resolve, and to different money
  select count(*), coalesce(sum(line_cost), 0) into v_lines, v_std
  from public.resolve_template_parts(v_tpl, 'Chrome', 'Tank Style', null, 'Standard');
  select count(*) filter (where not resolved) into v_unresolved
  from public.resolve_template_parts(v_tpl, 'Chrome', 'Tank Style', null, 'Standard');
  if v_unresolved <> 0 then
    raise exception 'Standard left % lines unresolved', v_unresolved;
  end if;

  select coalesce(sum(line_cost), 0) into v_cat
  from public.resolve_template_parts(v_tpl, 'Chrome', 'Tank Style', null, 'Catalytic');
  select count(*) filter (where not resolved) into v_unresolved
  from public.resolve_template_parts(v_tpl, 'Chrome', 'Tank Style', null, 'Catalytic');
  if v_unresolved <> 0 then
    raise exception 'Catalytic left % lines unresolved', v_unresolved;
  end if;

  if round(v_cat - v_std, 2) <> 161.71 then
    raise exception 'catalytic should cost 161.71 more, it is %', round(v_cat - v_std, 2);
  end if;

  -- an unpicked carbon type leaves the line unresolved rather than guessing
  select count(*) filter (where not resolved) into v_unresolved
  from public.resolve_template_parts(v_tpl, 'Chrome', 'Tank Style', null, null);
  if v_unresolved <> 1 then
    raise exception 'a job with no carbon type picked should have exactly one unresolved line, it has %', v_unresolved;
  end if;

  -- every existing job still resolves, which is what the backfill is for
  for v_job in
    select j.id, j.customer_name, j.carbon_type
    from public.jobs j join public.system_templates t on t.id = j.template_id
    where t.label = 'Filtration Only'
  loop
    if v_job.carbon_type is null then
      raise exception 'job % has no carbon type after the backfill', v_job.customer_name;
    end if;

    -- The carbon line specifically. Two of these jobs are quotes with no
    -- faucet finish picked yet, so they carry an unresolved faucet line and
    -- did before this migration: counting every unresolved line would fail on
    -- a gap this change did not cause.
    select count(*) filter (where not resolved and pick_source = 'carbon_type')
      into v_unresolved
    from public.resolve_job_parts(v_job.id);
    if v_unresolved <> 0 then
      raise exception 'job % cannot resolve its carbon tank', v_job.customer_name;
    end if;
  end loop;

  -- the other sheets are untouched
  select count(*) filter (where not resolved) into v_unresolved
  from public.resolve_template_parts(
    (select id from public.system_templates where label = 'Flagship Bundle'),
    'Chrome', 'Tank Style', 'Clack', null);
  if v_unresolved <> 0 then
    raise exception 'the Flagship Bundle stopped resolving';
  end if;
end $$;

notify pgrst, 'reload schema';
