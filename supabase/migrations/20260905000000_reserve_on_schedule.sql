-- Parts are claimed when a job is scheduled, not when it is sold.
--
-- A sale is a promise to a customer. A date is a promise to the shelf, and
-- only the second one should take stock out of circulation. Selling four
-- systems in a week with no dates on any of them was quietly making the last
-- one look unsellable, which is the opposite of what the reservation layer is
-- for: it exists to stop two booked jobs claiming the same tank, not to stop
-- the fourth sale of the week.
--
-- Everything else about the layer is unchanged. Installing still deducts from
-- the ledger, cancelling still releases, and the overbooking warning at
-- scheduling time still works because job_schedule_conflicts measures a job
-- against what *other* jobs hold and never against its own claim.

-- ---------------------------------------------------------------------------
-- a claim can now end because the date went away
-- ---------------------------------------------------------------------------
alter table public.job_reservations
  drop constraint if exists job_reservations_release_shape;

alter table public.job_reservations
  add constraint job_reservations_release_shape check (
    (released_at is null and released_reason is null)
    or (
      released_at is not null
      and released_reason in ('installed', 'cancelled', 'template_changed', 'manual', 'unscheduled')
    )
  );

-- ---------------------------------------------------------------------------
-- the rule itself
--
-- One new branch: no date, no claim. It sits after the installed and cancelled
-- checks, because those releases carry more specific reasons and a job that is
-- installed has consumed its parts rather than let go of them.
-- ---------------------------------------------------------------------------
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
      'job_id',           p_job_id,
      'template_id',      null,
      'open_lines',       0,
      'released_lines',   v_released,
      'units_committed',  0,
      'unresolved_lines', 0
    );
  end if;

  -- No date, no claim. A sold job waiting to be booked holds nothing, and
  -- clearing the date on a booked one hands the parts straight back.
  if v_job.scheduled_date is null then
    update public.job_reservations
    set released_at     = now(),
        released_reason = 'unscheduled'
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
$fn$;

-- ---------------------------------------------------------------------------
-- what makes the rule run again
--
-- scheduled_date is the whole point of this change and was not being watched,
-- so booking a job would have left it holding nothing.
--
-- ro_type was not being watched either, which is a fault that predates this:
-- it decides which RO unit a customer_pick line resolves to, exactly as
-- faucet_finish does, so changing it moved the parts a job needs without
-- moving what it had claimed. Fixed here because it is the same list.
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
     and new.parts_deducted_at is not distinct from old.parts_deducted_at then
    return null;
  end if;

  perform public.sync_job_reservations(new.id);
  return null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- the same rule at the table, for anything that writes a reservation directly
-- ---------------------------------------------------------------------------
create or replace function public.job_reservations_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_job public.jobs%rowtype;
begin
  if new.released_at is not null then
    return new;
  end if;

  select * into v_job from public.jobs where id = new.job_id;

  if v_job.status = 'installed' then
    raise exception 'This job is already installed, so its parts are consumed rather than reserved.'
      using errcode = 'WB014';
  end if;

  if v_job.status = 'cancelled' then
    raise exception 'This job is cancelled, so it cannot hold a reservation. Reopen it first.'
      using errcode = 'WB014';
  end if;

  if v_job.scheduled_date is null then
    raise exception 'This job has no date, so it does not claim parts yet. Schedule it first.'
      using errcode = 'WB014';
  end if;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- releasing by hand can say the same thing
-- ---------------------------------------------------------------------------
create or replace function public.release_job_reservations(
  p_job_id uuid, p_reason text default 'manual'
)
returns json
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_released int;
begin
  if p_job_id is null then
    raise exception 'No job was given to release reservations for.' using errcode = 'WB012';
  end if;

  if p_reason is null
     or p_reason not in ('installed', 'cancelled', 'template_changed', 'manual', 'unscheduled') then
    raise exception 'A reservation is released as installed, cancelled, template_changed, manual or unscheduled, not "%".',
      coalesce(p_reason, 'null')
      using errcode = 'WB013';
  end if;

  update public.job_reservations
  set released_at     = now(),
      released_reason = p_reason
  where job_id = p_job_id
    and released_at is null;

  get diagnostics v_released = row_count;

  return json_build_object(
    'job_id',         p_job_id,
    'released_lines', v_released,
    'reason',         p_reason
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- bring what already exists into line
--
-- Every open claim held by a job with no date goes back on the shelf. Done as
-- a direct update rather than by re-running the sync per job, so the reason
-- recorded is the real one and nothing else about those jobs is touched.
-- ---------------------------------------------------------------------------
update public.job_reservations r
set released_at     = now(),
    released_reason = 'unscheduled'
from public.jobs j
where j.id = r.job_id
  and r.released_at is null
  and j.scheduled_date is null
  and j.status not in ('installed', 'cancelled');

-- ---------------------------------------------------------------------------
-- and prove it, so a broken migration cannot apply quietly
-- ---------------------------------------------------------------------------
do $$
declare
  v_stragglers int;
begin
  select count(*) into v_stragglers
  from public.job_reservations r
  join public.jobs j on j.id = r.job_id
  where r.released_at is null
    and j.scheduled_date is null;

  if v_stragglers <> 0 then
    raise exception '% reservation(s) are still held by jobs with no date', v_stragglers;
  end if;
end $$;

notify pgrst, 'reload schema';
