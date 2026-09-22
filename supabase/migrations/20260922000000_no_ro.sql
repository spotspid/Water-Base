-- No RO: a job that takes the whole home system and no drinking water unit.
--
-- The bundles carry an RO as three lines: the RO unit, picked by ro_type; the
-- alkaline filter, a fixed line whose item is in the RO category; and the RO
-- faucet, picked by faucet_finish. A customer who wants the softener or the
-- well system without an RO had no way to say so. Picking an RO type anyway
-- reserved a unit nobody would install and counted its cost against the job.
--
-- "No RO" is an RO type like the others, so it sits in the same dropdown. When
-- a job has it, resolve_template_parts leaves all three lines out. That one
-- function feeds the New quote preview, reservations, schedule readiness and
-- job_margin, so every one of them sees the same shorter list without being
-- told anything.
--
-- The faucet goes with the RO. "N/A" is the faucet finish for a job with no RO
-- and for nothing else: a faucet marked not applicable on a job that has an RO
-- would leave the RO line with no faucet and nobody would notice until the
-- install. The trigger below sets it when No RO is picked and refuses it
-- otherwise, so the rule holds however the job is written.
--
-- A job-specific parts list (job_parts) is left alone. It is typed by hand,
-- item by item, and saying No RO does not overrule a list somebody wrote out.

-- ---------------------------------------------------------------------------
-- the two options
-- ---------------------------------------------------------------------------

insert into public.settings_options (list_key, value, sort_order, active)
values ('ro_type', 'No RO', 30, true),
       ('faucet_finish', 'N/A', 90, true)
on conflict (list_key, value) do update set active = true;

-- The rules below are keyed on these two exact words. Renaming either in
-- Settings would quietly turn No RO back into a pick for an RO unit that does
-- not exist, and every No RO job would show an unresolved line. So they
-- cannot be renamed or removed. Hiding one is still allowed; the rules do not
-- depend on it being listed.
create or replace function public.settings_options_guard_ro_words()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.list_key = 'ro_type' and old.value = 'No RO')
     or (old.list_key = 'faucet_finish' and old.value = 'N/A') then
    if tg_op = 'DELETE'
       or new.value is distinct from old.value
       or new.list_key is distinct from old.list_key then
      raise exception using
        errcode = 'WB030',
        message = format('"%s" cannot be renamed or removed. The parts rules for jobs with no RO depend on that exact name. You can hide it instead.', old.value);
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists settings_options_guard_ro_words on public.settings_options;
create trigger settings_options_guard_ro_words
  before update or delete on public.settings_options
  for each row execute function public.settings_options_guard_ro_words();

-- ---------------------------------------------------------------------------
-- the parts
-- ---------------------------------------------------------------------------

-- Unchanged from the live definition except for the last condition. An RO
-- line is recognised by what it is rather than by where it sits on a sheet:
-- the two picks the RO decides, and any fixed line whose item is filed under
-- RO. A new RO accessory added to a sheet is dropped with the rest without
-- this function learning its name.
create or replace function public.resolve_template_parts(
  p_template_id uuid,
  p_faucet_finish text default null,
  p_ro_type text default null,
  p_valve_type text default null
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
                      end
    order by i.created_at, i.id
    limit 1
  ) pick on true
  where tl.template_id = p_template_id
    -- Every operand is coalesced. A fixed line has no pick_source, and a null
    -- inside NOT (...) makes the whole condition null, which a WHERE reads as
    -- false: the first draft of this dropped the softener and the salt along
    -- with the RO, and the proof below is what caught it.
    and not (
      coalesce(p_ro_type, '') = 'No RO'
      and (
        coalesce(tl.pick_source, '') in ('ro_type', 'faucet_finish')
        or (tl.line_type = 'fixed' and coalesce(fixed_item.category, '') = 'RO')
      )
    )
  order by tl.sort_order, tl.id
$function$;

-- ---------------------------------------------------------------------------
-- the rules on a job
-- ---------------------------------------------------------------------------

create or replace function public.jobs_ro_picks()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ro_type = 'No RO' then
    -- No RO means no faucet. Set rather than refused, so picking No RO is one
    -- choice and not two that have to agree.
    new.faucet_finish := 'N/A';

    -- A sheet whose every line is part of the RO has nothing left to install.
    -- RO Only is the one that exists today. A sheet with no lines at all, such
    -- as Custom, is not refused: its parts are listed per job.
    if new.template_id is not null
       and exists (select 1 from public.template_lines where template_id = new.template_id)
       and not exists (select 1 from public.resolve_template_parts(new.template_id, 'N/A', 'No RO', new.valve_type))
    then
      raise exception using
        errcode = 'WB029',
        message = 'That build sheet is only an RO, so No RO would leave nothing to install. Pick a different build sheet, or an RO type.';
    end if;

  elsif new.faucet_finish = 'N/A' then
    if tg_op = 'UPDATE' and old.ro_type = 'No RO' then
      -- The RO has just come back. Its faucet needs a real finish, so the pick
      -- goes back to blank rather than keeping a finish that means no faucet.
      new.faucet_finish := null;
    else
      raise exception using
        errcode = 'WB028',
        message = 'Faucet finish N/A is only for a job with no RO. Pick a finish, or set the RO type to No RO.';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists jobs_ro_picks on public.jobs;
create trigger jobs_ro_picks
  before insert or update of ro_type, faucet_finish, template_id on public.jobs
  for each row execute function public.jobs_ro_picks();

-- ---------------------------------------------------------------------------
-- proof
-- ---------------------------------------------------------------------------

do $$
declare
  v_flagship uuid;
  v_ro_only uuid;
  v_softener uuid;
  v_with integer;
  v_without integer;
  v_left text;
  v_job uuid;
  v_faucet text;
  v_seq bigint;
begin
  select last_value into v_seq from public.job_invoice_number_seq;
  select id into v_flagship from public.system_templates where label = 'Flagship Bundle';
  select id into v_ro_only  from public.system_templates where label = 'RO Only';
  select id into v_softener from public.system_templates where label = 'Softener Only';

  if v_flagship is not null then
    select count(*) into v_with
    from public.resolve_template_parts(v_flagship, 'Chrome', 'Tank Style', null);
    select count(*), string_agg(coalesce(sku, pick_source), ',' order by sort_order)
      into v_without, v_left
    from public.resolve_template_parts(v_flagship, 'N/A', 'No RO', null);

    if v_with - v_without <> 3 then
      raise exception 'No RO dropped % lines from the Flagship Bundle, expected 3', v_with - v_without;
    end if;
    if v_left like '%RO-%' or v_left like '%faucet%' or v_left like '%ro_type%' then
      raise exception 'an RO line survived No RO: %', v_left;
    end if;
    if v_left not like '%MB-1054%' then
      raise exception 'No RO took the softener with it: %', v_left;
    end if;
  end if;

  -- a sheet with no RO is untouched by picking No RO
  if v_softener is not null then
    select count(*) into v_with from public.resolve_template_parts(v_softener, null, null, null);
    select count(*) into v_without from public.resolve_template_parts(v_softener, 'N/A', 'No RO', null);
    if v_with <> v_without then
      raise exception 'No RO changed a sheet that has no RO';
    end if;
  end if;

  -- the RO types that are not No RO resolve exactly as before
  if v_flagship is not null then
    select count(*) into v_with
    from public.resolve_template_parts(v_flagship, 'Chrome', 'Tankless', null) where resolved;
    if v_with < 5 then
      raise exception 'a Tankless pick stopped resolving';
    end if;
  end if;

  -- The job rules, on a job that exists only inside this block.
  --
  -- It carries its own invoice number. Leaving it blank draws the next one
  -- from job_invoice_number_seq, and a sequence does not roll back: the first
  -- run of this file spent MWP-0020 on a job that never existed and left a
  -- gap in the real numbering, which had to be put back by hand.
  if v_flagship is not null then
    insert into public.jobs (customer_name, phone, address, city, water_source, system_template,
                             template_id, status, sale_price, ro_type, faucet_finish, is_test,
                             invoice_number)
    values ('PROOF no ro', '555-0100', '1 Proof Lane', 'Novi', 'city', 'Flagship Bundle',
            v_flagship, 'quoted', 2999, 'No RO', 'Chrome', true, 'PROOF-NO-RO-1')
    returning id, faucet_finish into v_job, v_faucet;

    if v_faucet <> 'N/A' then
      raise exception 'No RO did not set the faucet to N/A, it is %', v_faucet;
    end if;

    -- the RO comes back: the faucet goes to blank, not N/A
    update public.jobs set ro_type = 'Tank Style' where id = v_job
    returning faucet_finish into v_faucet;
    if v_faucet is not null then
      raise exception 'bringing the RO back left the faucet as %', v_faucet;
    end if;

    -- N/A on a job with an RO is refused
    begin
      update public.jobs set faucet_finish = 'N/A' where id = v_job;
      raise exception 'N/A was accepted on a job with an RO';
    exception when sqlstate 'WB028' then null;
    end;

    delete from public.jobs where id = v_job;
  end if;

  -- No RO on RO Only is refused
  if v_ro_only is not null then
    begin
      insert into public.jobs (customer_name, phone, address, city, water_source, system_template,
                               template_id, status, sale_price, ro_type, is_test, invoice_number)
      values ('PROOF ro only', '555-0100', '1 Proof Lane', 'Novi', 'city', 'RO Only',
              v_ro_only, 'quoted', 1200, 'No RO', true, 'PROOF-NO-RO-2');
      raise exception 'No RO was accepted on RO Only';
    exception when sqlstate 'WB029' then null;
    end;
  end if;

  if (select last_value from public.job_invoice_number_seq) <> v_seq then
    raise exception 'this proof spent an invoice number';
  end if;

  -- the two words cannot be renamed
  begin
    update public.settings_options set value = 'Without RO'
    where list_key = 'ro_type' and value = 'No RO';
    raise exception 'No RO was renamed';
  exception when sqlstate 'WB030' then null;
  end;
end $$;

notify pgrst, 'reload schema';
