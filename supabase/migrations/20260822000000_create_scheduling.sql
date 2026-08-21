-- scheduling layer: put a job on a day, in a window, with a crew.
--
-- the rules the earlier modules set stay in force here:
--   on hand is never stored, it is summed from inventory_transactions.
--   committed is never stored, it is summed from open job_reservations.
-- scheduling adds no new totals. it reads the reservation layer to warn, and
-- writes nothing to it beyond what the existing job trigger already does.
--
-- the split between scheduled_date and install_date is deliberate.
-- scheduled_date is the promise, install_date is what happened. a job booked
-- for the 9th and installed on the 11th should show both, so the calendar
-- reads scheduled_date while the job is open and install_date once it is not.

-- ---------------------------------------------------------------------------
-- installers: the crew roster.
--
-- a managed list rather than free text, so the calendar can group by person
-- and a rename fixes every job at once. rows are turned off rather than
-- deleted, matching how every other pick list in this app behaves, because a
-- job installed last spring still has to say who did it.
-- ---------------------------------------------------------------------------
create table if not exists public.installers (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null,
  phone      text,
  color      text not null default '#2C819B',
  active     boolean not null default true,
  sort_order int not null default 0,
  constraint installers_name_not_blank check (btrim(name) <> ''),
  constraint installers_color_shape check (color ~ '^#[0-9A-Fa-f]{6}$')
);

-- one person per name, case insensitively, so "Dave" and "dave" cannot both
-- exist and split a day's work between two rows that look identical.
create unique index if not exists installers_name_uniq
  on public.installers (lower(btrim(name)));

create index if not exists installers_active_idx
  on public.installers (active, sort_order);

-- ---------------------------------------------------------------------------
-- jobs gains the scheduling fields.
--
-- installer_id and helper_id both point at the same roster. on delete
-- restrict, because losing who did a job to a stray delete is not recoverable
-- from anywhere else. the roster is turned off instead, which the guard
-- below and the settings editor both understand.
-- ---------------------------------------------------------------------------
alter table public.jobs
  add column if not exists scheduled_date date;

alter table public.jobs
  add column if not exists time_window text;

alter table public.jobs
  add column if not exists installer_id uuid references public.installers(id) on delete restrict;

alter table public.jobs
  add column if not exists helper_id uuid references public.installers(id) on delete restrict;

-- a person cannot help themselves. this catches the mis click where the same
-- name is picked twice and a one person job looks like a two person job.
do $crewcheck$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_crew_distinct'
  ) then
    alter table public.jobs
      add constraint jobs_crew_distinct
      check (helper_id is null or installer_id is null or helper_id <> installer_id);
  end if;
end
$crewcheck$;

create index if not exists jobs_scheduled_date_idx
  on public.jobs (scheduled_date)
  where scheduled_date is not null;

create index if not exists jobs_installer_id_idx
  on public.jobs (installer_id)
  where installer_id is not null;

-- ---------------------------------------------------------------------------
-- time windows join the managed pick lists.
--
-- the same settings_options table that holds cities and finishes, so the
-- existing editor, the usage guard and the active flag all apply without a
-- second mechanism.
--
-- the list_key check is widened rather than dropped. it is what stops a typo
-- in a list name from creating a fifth list nothing reads, so it keeps
-- earning its place once time_window is on it.
-- ---------------------------------------------------------------------------
alter table public.settings_options
  drop constraint if exists settings_options_list_key_check;

alter table public.settings_options
  add constraint settings_options_list_key_check
  check (list_key in (
    'inventory_category', 'service_city', 'faucet_finish', 'payment_type', 'time_window'));

insert into public.settings_options (list_key, value, sort_order)
select 'time_window', v, (i * 10)
from unnest(array[
  '8:00 AM - 10:00 AM',
  '10:00 AM - 12:00 PM',
  '12:00 PM - 2:00 PM',
  '2:00 PM - 4:00 PM',
  '4:00 PM - 6:00 PM',
  'All Day'
]) with ordinality as t(v, i)
on conflict (list_key, value) do nothing;

-- teach the usage counter about the new list, so removing a window that jobs
-- still reference is refused with the same message as every other list.
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
    else 0
  end)::int
$usage$;

-- ---------------------------------------------------------------------------
-- jobs_sync_installer_name: keep the legacy text column in step with the id.
--
-- jobs.installer is read by job_margin and written by mark_job_installed, and
-- both predate the roster. rather than rewrite either, the id is treated as
-- the source of truth and the text follows it. a job with no installer_id
-- keeps whatever text it has, so nothing written before this migration is
-- blanked out.
-- ---------------------------------------------------------------------------
create or replace function public.jobs_sync_installer_name()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $installername$
declare
  v_name text;
begin
  if new.installer_id is null then
    return new;
  end if;

  select btrim(name) into v_name from public.installers where id = new.installer_id;

  if v_name is null then
    raise exception 'That installer is no longer on the roster. Pick someone else.'
      using errcode = 'WB015';
  end if;

  new.installer := v_name;
  return new;
end;
$installername$;

drop trigger if exists jobs_sync_installer_name on public.jobs;

create trigger jobs_sync_installer_name
  before insert or update of installer_id on public.jobs
  for each row execute function public.jobs_sync_installer_name();

-- ---------------------------------------------------------------------------
-- backfill: seed the roster from the names already typed on jobs, then point
-- each of those jobs at its new row. free text that was consistent becomes a
-- roster entry, free text that was a typo becomes its own entry an operator
-- can turn off, which is visible rather than silently merged.
-- ---------------------------------------------------------------------------
insert into public.installers (name, sort_order)
select j.installer, (row_number() over (order by lower(j.installer))) * 10
from (
  select distinct btrim(installer) as installer
  from public.jobs
  where installer is not null and btrim(installer) <> ''
) j
on conflict do nothing;

update public.jobs j
set installer_id = i.id
from public.installers i
where j.installer_id is null
  and j.installer is not null
  and lower(btrim(j.installer)) = lower(btrim(i.name));

-- a job that already has a date was scheduled for it, whether or not anyone
-- called it that at the time. this is what puts existing work on the calendar
-- on first load instead of showing an empty week.
update public.jobs
set scheduled_date = install_date
where scheduled_date is null
  and install_date is not null;

-- ---------------------------------------------------------------------------
-- job_schedule: one calendar ready row per job.
--
-- calendar_date is the single column a week or month view reads. an open job
-- shows where it is promised, a finished job shows where it landed, and a job
-- with neither date stays off the calendar and appears in the unscheduled
-- list instead.
-- ---------------------------------------------------------------------------
create or replace view public.job_schedule
with (security_invoker = true) as
select
  j.id,
  j.created_at,
  j.customer_name,
  j.phone,
  j.address,
  j.city,
  j.system_template,
  j.template_id,
  j.faucet_finish,
  j.status,
  j.sale_price,
  j.invoice_number,
  j.notes,
  j.scheduled_date,
  j.install_date,
  coalesce(j.scheduled_date, j.install_date) as calendar_date,
  j.time_window,
  coalesce(w.sort_order, 9999)              as time_window_sort,
  j.installer_id,
  ins.name                                  as installer_name,
  ins.color                                 as installer_color,
  ins.active                                as installer_active,
  j.helper_id,
  hlp.name                                  as helper_name,
  j.installer                               as installer_text,
  j.parts_deducted_at
from public.jobs j
left join public.installers ins on ins.id = j.installer_id
left join public.installers hlp on hlp.id = j.helper_id
left join public.settings_options w
       on w.list_key = 'time_window' and w.value = j.time_window;

-- ---------------------------------------------------------------------------
-- job_schedule_conflicts: can this job actually get its parts on that day.
--
-- the question is not whether stock exists, it is whether stock exists that
-- nobody else has already claimed. so this job's own reservation is excluded
-- from the committed total, and what is left is what the rest of the book has
-- promised away. required minus that is the shortfall.
--
-- returns only the lines that are short. no rows means nothing to warn about.
-- this reports, it never blocks. a shortfall on the 9th is often fixed by a
-- delivery on the 8th, and refusing the booking would be refusing information
-- the person doing the scheduling already has.
-- ---------------------------------------------------------------------------
create or replace function public.job_schedule_conflicts(p_job_id uuid)
returns table (
  item_id          uuid,
  sku              text,
  item_name        text,
  required         int,
  on_hand          int,
  committed_other  int,
  available_other  int,
  shortfall        int,
  competing_jobs   json
)
language plpgsql
stable
security invoker
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

  -- an installed job already consumed its parts and a cancelled one holds
  -- none, so neither can be short of anything.
  if v_job.status in ('installed', 'cancelled') or v_job.parts_deducted_at is not null then
    return;
  end if;

  v_template_id := coalesce(
    v_job.template_id,
    (select t.id from public.system_templates t where t.label = v_job.system_template)
  );

  -- no template means no parts list, so there is nothing to be short of.
  if v_template_id is null then
    return;
  end if;

  return query
  with needed as (
    select r.item_id as need_item_id, sum(r.quantity)::int as required
    from public.resolve_template_parts(v_template_id, v_job.faucet_finish) r
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
-- schedule_job: put a job on a day and report what is short.
--
-- one call so a drag on the calendar is one round trip and one transaction.
-- a job that was sold becomes scheduled, because a date and a crew is what
-- scheduled means. everything else about the job is left alone.
--
-- p_set_crew exists so a drag can move a job to another day without touching
-- who is on it. a drag sends false, the edit form sends true.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_job(
  p_job_id         uuid,
  p_scheduled_date date default null,
  p_time_window    text default null,
  p_installer_id   uuid default null,
  p_helper_id      uuid default null,
  p_set_crew       boolean default true
)
returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $schedule$
declare
  v_job        public.jobs%rowtype;
  v_installer  public.installers%rowtype;
  v_helper     public.installers%rowtype;
  v_conflicts  json;
  v_count      int;
  v_status     text;
begin
  if p_job_id is null then
    raise exception 'No job was given to schedule.' using errcode = 'WB016';
  end if;

  select * into v_job from public.jobs where id = p_job_id for update;

  if not found then
    raise exception 'That job no longer exists, so it cannot be scheduled. Reload the list.'
      using errcode = 'WB016';
  end if;

  if v_job.status = 'installed' then
    raise exception 'This job is already installed, so its date is a record of what happened. Reverse the install before rescheduling it.'
      using errcode = 'WB017';
  end if;

  if v_job.status = 'cancelled' then
    raise exception 'This job is cancelled, so it cannot be scheduled. Reopen it first.'
      using errcode = 'WB017';
  end if;

  if p_time_window is not null and btrim(p_time_window) <> '' then
    if not exists (
      select 1 from public.settings_options
      where list_key = 'time_window' and value = p_time_window
    ) then
      raise exception 'There is no time window called "%". Pick one from the list or add it in Settings.',
        p_time_window
        using errcode = 'WB018';
    end if;
  end if;

  if p_set_crew then
    if p_installer_id is not null then
      select * into v_installer from public.installers where id = p_installer_id;
      if not found then
        raise exception 'That installer is not on the roster. Reload and pick again.'
          using errcode = 'WB015';
      end if;
      if not v_installer.active then
        raise exception '% is turned off on the roster, so they cannot be assigned new work. Turn them back on in Settings.',
          v_installer.name
          using errcode = 'WB015';
      end if;
    end if;

    if p_helper_id is not null then
      select * into v_helper from public.installers where id = p_helper_id;
      if not found then
        raise exception 'That helper is not on the roster. Reload and pick again.'
          using errcode = 'WB015';
      end if;
      if not v_helper.active then
        raise exception '% is turned off on the roster, so they cannot be assigned new work. Turn them back on in Settings.',
          v_helper.name
          using errcode = 'WB015';
      end if;
    end if;

    if p_installer_id is not null and p_helper_id is not null and p_installer_id = p_helper_id then
      raise exception 'The installer and the helper cannot be the same person.'
        using errcode = 'WB019';
    end if;
  end if;

  -- a job with a date is scheduled. clearing the date puts it back in the
  -- unscheduled list, where it is sold again rather than stranded.
  v_status := case
    when p_scheduled_date is not null then 'scheduled'
    when v_job.status = 'scheduled'   then 'sold'
    else v_job.status
  end;

  update public.jobs
  set scheduled_date = p_scheduled_date,
      time_window    = case
                         when p_scheduled_date is null then null
                         when p_time_window is null or btrim(p_time_window) = '' then null
                         else p_time_window
                       end,
      installer_id   = case when p_set_crew then p_installer_id else installer_id end,
      helper_id      = case when p_set_crew then p_helper_id    else helper_id    end,
      status         = v_status
  where id = p_job_id
  returning * into v_job;

  select coalesce(json_agg(to_json(c)), '[]'::json), count(*)::int
    into v_conflicts, v_count
  from public.job_schedule_conflicts(p_job_id) c;

  return json_build_object(
    'job_id',         p_job_id,
    'scheduled_date', v_job.scheduled_date,
    'time_window',    v_job.time_window,
    'installer_id',   v_job.installer_id,
    'helper_id',      v_job.helper_id,
    'status',         v_job.status,
    'conflict_count', v_count,
    'conflicts',      v_conflicts
  );
end;
$schedule$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.installers enable row level security;

drop policy if exists "installers_select" on public.installers;
drop policy if exists "installers_insert" on public.installers;
drop policy if exists "installers_update" on public.installers;
drop policy if exists "installers_delete" on public.installers;

create policy "installers_select" on public.installers
  for select to authenticated using ((select auth.uid()) is not null);

create policy "installers_insert" on public.installers
  for insert to authenticated with check ((select auth.uid()) is not null);

create policy "installers_update" on public.installers
  for update to authenticated using ((select auth.uid()) is not null);

create policy "installers_delete" on public.installers
  for delete to authenticated using ((select auth.uid()) is not null);

grant execute on function public.schedule_job(uuid, date, text, uuid, uuid, boolean) to authenticated;
grant execute on function public.job_schedule_conflicts(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- job_margin gains the scheduling fields.
--
-- appended rather than woven in, because create or replace view can add
-- columns at the end but cannot reorder or retype the ones already there.
-- the Jobs page and the job detail modal read this view, so without these
-- they would have to make a second round trip for the crew on every row.
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
  hlp.name  as helper_name
from public.jobs j
left join public.installers ins on ins.id = j.installer_id
left join public.installers hlp on hlp.id = j.helper_id
left join (
  select
    t.job_id,
    sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)) as parts_cost,
    sum(-t.quantity)                                   as parts_count
  from public.inventory_transactions t
  where t.job_id is not null
  group by t.job_id
) p on p.job_id = j.id;

notify pgrst, 'reload schema';
