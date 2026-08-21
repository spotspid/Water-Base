-- reservation layer: parts claimed at booking without moving stock.
--
-- architecture rules carried over from the inventory and BOM modules:
--   on hand is never stored. it is summed from inventory_transactions.
--   parts cost is never stored. it is summed from the same ledger.
-- this module adds a third rule of the same shape:
--   committed is never stored either. it is summed from job_reservations,
--   counting only the rows that are still open.
--
-- a reservation is a claim, not a movement. nothing here writes to
-- inventory_transactions, so on hand is untouched by booking a job. the
-- ledger is still written by mark_job_installed and by nothing else, which
-- keeps deduction tied to the install event rather than to a date passing.

-- ---------------------------------------------------------------------------
-- job_reservations: one open row per job per item.
--
-- released_at is the whole state machine. null means the claim is live and
-- counts against available. a timestamp means the claim is over, and the
-- reason says which of the endings it was. rows are released rather than
-- deleted so a job's history of claims survives being installed, cancelled,
-- reopened and installed again.
-- ---------------------------------------------------------------------------
create table if not exists public.job_reservations (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  job_id          uuid not null references public.jobs(id) on delete cascade,
  item_id         uuid not null references public.inventory_items(id) on delete restrict,
  quantity        int not null check (quantity > 0),
  released_at     timestamptz,
  released_reason text,
  created_by      uuid references auth.users(id) default auth.uid(),
  constraint job_reservations_release_shape check (
    (released_at is null and released_reason is null)
    or
    (released_at is not null
       and released_reason in ('installed', 'cancelled', 'template_changed', 'manual'))
  )
);

-- one live claim per job per item. a template asking for the same item twice
-- is summed into one row, exactly as the deduct path sums it into one ledger
-- row, so the two layers always agree on the count.
create unique index if not exists job_reservations_open_uniq
  on public.job_reservations (job_id, item_id)
  where released_at is null;

-- the index the committed total reads. partial, because released rows are
-- history and never enter the sum.
create index if not exists job_reservations_open_item_idx
  on public.job_reservations (item_id)
  where released_at is null;

create index if not exists job_reservations_job_id_idx
  on public.job_reservations (job_id);

-- ---------------------------------------------------------------------------
-- jobs.status gains cancelled.
--
-- a cancelled job releases its claims but keeps its row, so the reason a
-- reservation ended is still readable months later. the existing install
-- guard already refuses any status change that would strand deducted parts,
-- so an installed job has to be reversed before it can be cancelled.
-- ---------------------------------------------------------------------------
alter table public.jobs drop constraint if exists jobs_status_check;

alter table public.jobs
  add constraint jobs_status_check
  check (status in ('sold', 'scheduled', 'installed', 'cancelled'));

-- ---------------------------------------------------------------------------
-- inventory_stock gains committed and available.
--
-- the two totals come from separate subqueries rather than from one join.
-- joining the ledger and the reservations together would multiply each
-- transaction by every open reservation and silently inflate on hand, which
-- is the kind of wrong that looks right until a second reservation exists.
--
-- available is allowed to go negative. that is a real state, meaning more is
-- promised than is on the shelf, and flooring it at zero would hide the one
-- number worth acting on.
-- ---------------------------------------------------------------------------
create or replace view public.inventory_stock
with (security_invoker = true) as
select
  i.id,
  i.created_at,
  i.sku,
  i.name,
  i.category,
  i.variant,
  i.unit_cost,
  i.reorder_threshold,
  i.active,
  i.notes,
  coalesce(t.on_hand, 0)::int as on_hand,
  round(coalesce(t.on_hand, 0) * i.unit_cost, 2) as stock_value,
  coalesce(r.committed, 0)::int as committed,
  (coalesce(t.on_hand, 0) - coalesce(r.committed, 0))::int as available
from public.inventory_items i
left join (
  select tx.item_id, sum(tx.quantity) as on_hand
  from public.inventory_transactions tx
  group by tx.item_id
) t on t.item_id = i.id
left join (
  select jr.item_id, sum(jr.quantity) as committed
  from public.job_reservations jr
  where jr.released_at is null
  group by jr.item_id
) r on r.item_id = i.id;

-- ---------------------------------------------------------------------------
-- job_reservation_lines: open claims with the job and item joined, so a
-- screen can answer which jobs are holding a given item.
-- ---------------------------------------------------------------------------
create or replace view public.job_reservation_lines
with (security_invoker = true) as
select
  jr.id,
  jr.created_at,
  jr.job_id,
  jr.item_id,
  jr.quantity,
  j.customer_name,
  j.status         as job_status,
  j.install_date,
  j.invoice_number,
  i.sku,
  i.name           as item_name,
  i.category       as item_category,
  i.variant        as item_variant,
  i.unit_cost,
  (jr.quantity * coalesce(i.unit_cost, 0))::numeric(10,2) as line_cost
from public.job_reservations jr
join public.jobs j            on j.id = jr.job_id
join public.inventory_items i on i.id = jr.item_id
where jr.released_at is null;

-- ---------------------------------------------------------------------------
-- job_reservations_guard: an installed or cancelled job cannot hold a live
-- claim. an installed job holds ledger rows instead, and counting both would
-- charge the same part to the same job twice.
-- ---------------------------------------------------------------------------
create or replace function public.job_reservations_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $guard$
declare
  v_status text;
begin
  if new.released_at is not null then
    return new;
  end if;

  select status into v_status from public.jobs where id = new.job_id;

  if v_status = 'installed' then
    raise exception 'This job is already installed, so its parts are consumed rather than reserved.'
      using errcode = 'WB014';
  end if;

  if v_status = 'cancelled' then
    raise exception 'This job is cancelled, so it cannot hold a reservation. Reopen it first.'
      using errcode = 'WB014';
  end if;

  return new;
end;
$guard$;

drop trigger if exists job_reservations_guard on public.job_reservations;

create trigger job_reservations_guard
  before insert or update on public.job_reservations
  for each row execute function public.job_reservations_guard();

-- ---------------------------------------------------------------------------
-- release_job_reservations: end every open claim on a job and say why.
-- ---------------------------------------------------------------------------
create or replace function public.release_job_reservations(
  p_job_id uuid,
  p_reason text default 'manual'
)
returns json
language plpgsql
security invoker
set search_path = public, pg_temp
as $release$
declare
  v_released int;
begin
  if p_job_id is null then
    raise exception 'No job was given to release reservations for.' using errcode = 'WB012';
  end if;

  if p_reason is null
     or p_reason not in ('installed', 'cancelled', 'template_changed', 'manual') then
    raise exception 'A reservation is released as installed, cancelled, template_changed or manual, not "%".',
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
$release$;

-- ---------------------------------------------------------------------------
-- sync_job_reservations: make the open claims match the resolved parts list.
--
-- this is the only writer of reservations in normal operation, and it is
-- idempotent. calling it twice in a row changes nothing the second time,
-- which is what lets a trigger call it on every relevant write without
-- keeping track of what already happened.
--
-- an unresolved line, meaning a customer pick with no matching item for the
-- chosen finish, is counted and reported but does not raise. booking is not
-- the moment to refuse: mark_job_installed already refuses the whole
-- deduction when a line cannot resolve, so the hard stop still sits in front
-- of the ledger. reserving what does resolve is better than reserving
-- nothing, and the count comes back so the caller can say what is missing.
-- ---------------------------------------------------------------------------
create or replace function public.sync_job_reservations(p_job_id uuid)
returns json
language plpgsql
security invoker
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

  -- lock the job so two concurrent syncs of the same job serialize here
  -- rather than racing to write the same claim.
  select * into v_job from public.jobs where id = p_job_id for update;

  if not found then
    raise exception 'That job no longer exists, so its reservations cannot be updated.'
      using errcode = 'WB012';
  end if;

  -- an installed job holds ledger rows, a cancelled job holds nothing.
  -- both end every open claim.
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

  -- no template means no parts list, so any claim still open is stale.
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

  -- one statement, so the release and the upsert see the same snapshot and
  -- the job is never momentarily over reserved. the two branches touch
  -- disjoint items by construction: released is what the list no longer
  -- wants, upserted is what it does.
  with wanted as (
    select r.item_id, sum(r.quantity)::int as quantity
    from public.resolve_template_parts(v_template_id, v_job.faucet_finish) r
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
  from public.resolve_template_parts(v_template_id, v_job.faucet_finish) r
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

-- ---------------------------------------------------------------------------
-- jobs_sync_reservations: keep the claims in step with the job on every
-- write, so a reservation cannot be missed by a caller that forgot to ask.
--
-- creating a job claims its parts. changing the template, the finish or the
-- status rewrites the claim. installing releases the claims and lets the
-- existing deduct logic write the ledger. cancelling releases them too.
-- ---------------------------------------------------------------------------
create or replace function public.jobs_sync_reservations()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $jobsync$
begin
  -- only the fields that can change what is claimed are worth a resync.
  if tg_op = 'UPDATE'
     and new.status            is not distinct from old.status
     and new.template_id       is not distinct from old.template_id
     and new.system_template   is not distinct from old.system_template
     and new.faucet_finish     is not distinct from old.faucet_finish
     and new.parts_deducted_at is not distinct from old.parts_deducted_at then
    return null;
  end if;

  perform public.sync_job_reservations(new.id);
  return null;
end;
$jobsync$;

drop trigger if exists jobs_sync_reservations on public.jobs;

create trigger jobs_sync_reservations
  after insert or update on public.jobs
  for each row execute function public.jobs_sync_reservations();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.job_reservations enable row level security;

drop policy if exists "job_reservations_select" on public.job_reservations;
drop policy if exists "job_reservations_insert" on public.job_reservations;
drop policy if exists "job_reservations_update" on public.job_reservations;
drop policy if exists "job_reservations_delete" on public.job_reservations;

create policy "job_reservations_select" on public.job_reservations
  for select to authenticated using ((select auth.uid()) is not null);

create policy "job_reservations_insert" on public.job_reservations
  for insert to authenticated with check ((select auth.uid()) is not null);

create policy "job_reservations_update" on public.job_reservations
  for update to authenticated using ((select auth.uid()) is not null);

create policy "job_reservations_delete" on public.job_reservations
  for delete to authenticated using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------
-- backfill: every job that is still open gets the claims it should have had
-- all along. installed and cancelled jobs are skipped, since sync would only
-- release what they do not have.
-- ---------------------------------------------------------------------------
do $backfill$
declare
  v_job_id uuid;
begin
  for v_job_id in
    select id from public.jobs
    where status in ('sold', 'scheduled')
      and parts_deducted_at is null
    order by created_at
  loop
    perform public.sync_job_reservations(v_job_id);
  end loop;
end
$backfill$;

grant execute on function public.sync_job_reservations(uuid) to authenticated;
grant execute on function public.release_job_reservations(uuid, text) to authenticated;

notify pgrst, 'reload schema';
