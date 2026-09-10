-- Setting a valve type claims a valve, and money cannot go negative.
--
-- Two findings from the edge case audit.
--
-- The reservation trigger decides whether a job's claims need recomputing by
-- comparing the columns that feed the build sheet. valve_type was added as a
-- third customer pick in 20260910010000 and this list was not widened with
-- it, so choosing a valve on a scheduled job changed nothing on the shelf
-- until some other column moved. The trigger itself fires on every update
-- with no column list, so only the function needs the extra line.
--
-- payout_amount and sale_price were checked by the forms and by
-- mark_job_installed, and by nothing at the table. A direct write of a
-- negative payout raised a finished job's margin by the same amount. The
-- table refuses both now. Nothing on the table is negative today, so the
-- constraints validate against every existing row.

-- ---------------------------------------------------------------------------
-- the trigger watches valve_type
-- ---------------------------------------------------------------------------
create or replace function public.jobs_sync_reservations()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'UPDATE'
     and new.status            is not distinct from old.status
     and new.scheduled_date    is not distinct from old.scheduled_date
     and new.template_id       is not distinct from old.template_id
     and new.system_template   is not distinct from old.system_template
     and new.faucet_finish     is not distinct from old.faucet_finish
     and new.ro_type           is not distinct from old.ro_type
     and new.valve_type        is not distinct from old.valve_type
     and new.parts_deducted_at is not distinct from old.parts_deducted_at then
    return null;
  end if;

  perform public.sync_job_reservations(new.id);
  return null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- bring every open booking's claims up to date with its sheet
--
-- The valve lines were added to three sheets yesterday and nothing has
-- resynced the jobs on them. A job still labelled but not linked to a sheet
-- would be refused by the sync, so it is left alone here rather than failing
-- the migration; the app refuses to schedule it anyway.
-- ---------------------------------------------------------------------------
do $$
declare
  v_job uuid;
begin
  for v_job in
    select j.id
    from public.jobs j
    where j.status not in ('installed', 'cancelled')
      and j.parts_deducted_at is null
      and j.scheduled_date is not null
      and (j.template_id is not null
           or not exists (select 1 from public.system_templates t where t.label = j.system_template))
  loop
    perform public.sync_job_reservations(v_job);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- money guards at the table
-- ---------------------------------------------------------------------------
alter table public.jobs drop constraint if exists jobs_payout_amount_check;
alter table public.jobs
  add constraint jobs_payout_amount_check
  check (payout_amount is null or payout_amount >= 0);

alter table public.jobs drop constraint if exists jobs_sale_price_check;
alter table public.jobs
  add constraint jobs_sale_price_check
  check (sale_price >= 0);

-- ---------------------------------------------------------------------------
-- prove it. Each trial runs in its own block and ends by raising, so nothing
-- it changed survives, and the migration fails if a trial did not behave.
-- ---------------------------------------------------------------------------
do $$
declare
  v_job     uuid;
  v_claimed int;
  v_refused boolean;
begin
  -- a valve chosen on a scheduled job claims a valve
  select j.id into v_job
  from public.jobs j
  join public.template_lines l on l.template_id = j.template_id and l.pick_source = 'valve_type'
  where j.status = 'scheduled' and j.parts_deducted_at is null and j.scheduled_date is not null
    and j.valve_type is null
  limit 1;

  if v_job is not null then
    begin
      update public.jobs set valve_type = 'Clack' where id = v_job;

      select count(*) into v_claimed
      from public.job_reservations jr
      join public.inventory_items i on i.id = jr.item_id
      where jr.job_id = v_job and jr.released_at is null and i.sku = 'VLV-CLACK';

      if v_claimed <> 1 then
        raise exception 'setting a valve type claimed % valves rather than one', v_claimed;
      end if;

      raise exception 'PROOF_ROLLBACK';
    exception
      when others then
        if sqlerrm <> 'PROOF_ROLLBACK' then raise; end if;
    end;
  end if;

  -- negative money is refused
  select id into v_job from public.jobs limit 1;

  if v_job is not null then
    v_refused := false;
    begin
      update public.jobs set payout_amount = -1 where id = v_job;
    exception when check_violation then v_refused := true;
    end;
    if not v_refused then raise exception 'a negative payout was accepted'; end if;

    v_refused := false;
    begin
      update public.jobs set sale_price = -1 where id = v_job;
    exception when check_violation then v_refused := true;
    end;
    if not v_refused then raise exception 'a negative sale price was accepted'; end if;
  end if;
end $$;

notify pgrst, 'reload schema';
