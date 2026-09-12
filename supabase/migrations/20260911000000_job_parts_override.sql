-- A job can carry its own parts list, and one resolver answers for every job.
--
-- The build sheet was the only way a job could name parts. That works until a
-- job is not a bundle. Three jobs are on the "Custom" sheet, which has no
-- lines at all, and two of those are booked to install. A sheet with no lines
-- resolves cleanly, because nothing to resolve cannot fail, so those jobs
-- claim nothing, deduct nothing, and record a parts cost of zero against a
-- real sale. The margin on them is not optimistic, it is fiction.
--
-- So: job_parts. Rows listed against one job rather than against a sheet.
--
-- The contract is override, not addition. A job with any job_parts rows uses
-- those rows as its parts list and ignores its sheet entirely. Addition would
-- have been the softer choice and it is the wrong one here: a job on Custom
-- would then be "the empty sheet plus these", which is the same list by a
-- longer road, while a job on Flagship that needs one part swapped would have
-- no way to take the original off. Override says one thing and says it once.
--
-- Every reader goes through resolve_job_parts from here. That is the lesson
-- of the build sheet migration, where sync_job_reservations and the work
-- order sender each resolved the sheet their own way and were separately
-- self consistent and jointly wrong. Four callers resolve a job's parts:
-- the reservation sync, the install deduction, the readiness report, and the
-- preview in the drawer. They now call one function.

-- ---------------------------------------------------------------------------
-- the rows
-- ---------------------------------------------------------------------------
create table if not exists public.job_parts (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  job_id     uuid not null references public.jobs(id) on delete cascade,
  item_id    uuid not null references public.inventory_items(id) on delete restrict,
  quantity   int  not null,
  note       text,
  sort_order int  not null default 0,
  constraint job_parts_quantity_check check (quantity > 0),
  constraint job_parts_one_row_per_item unique (job_id, item_id)
);

comment on table public.job_parts is
  'Parts listed against one job. Any rows here replace that job''s build sheet '
  'for reservations, readiness, the preview and the install deduction.';

create index if not exists job_parts_job_idx on public.job_parts (job_id);

alter table public.job_parts enable row level security;

drop policy if exists job_parts_select on public.job_parts;
create policy job_parts_select on public.job_parts
  for select to authenticated using ((select auth.uid()) is not null);

drop policy if exists job_parts_insert on public.job_parts;
create policy job_parts_insert on public.job_parts
  for insert to authenticated with check ((select auth.uid()) is not null);

drop policy if exists job_parts_update on public.job_parts;
create policy job_parts_update on public.job_parts
  for update to authenticated using ((select auth.uid()) is not null);

drop policy if exists job_parts_delete on public.job_parts;
create policy job_parts_delete on public.job_parts
  for delete to authenticated using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------
-- an installed job's list is a record, not a form
--
-- The ledger rows were written from whatever the list said on the day. Editing
-- the list afterwards would leave the two disagreeing with nothing to say
-- which was right, and the ledger is append only, so the edit could not be
-- carried through even if we wanted it to be. Refuse, and name the reason.
-- ---------------------------------------------------------------------------
create or replace function public.job_parts_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_job public.jobs%rowtype;
  v_id  uuid;
begin
  -- NEW is unassigned on a delete and OLD on an insert, so neither can be
  -- reached for unless the event says it is there.
  if tg_op = 'DELETE' then
    v_id := old.job_id;
  else
    v_id := new.job_id;
  end if;

  select * into v_job from public.jobs where id = v_id;

  -- A job deleted outright cascades to these rows, and the job is already gone
  -- by the time the cascade reaches here. That is the job being removed, not
  -- its list being edited, so it is allowed through.
  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;

    raise exception 'That job no longer exists, so its parts list cannot be changed.'
      using errcode = 'WB025';
  end if;

  if v_job.parts_deducted_at is not null then
    raise exception
      'This job installed on % and its parts are already in the ledger, which is '
      'append only. Its parts list cannot be changed. Reverse the install first '
      'if the list was wrong, which returns the parts to inventory.',
      to_char(v_job.parts_deducted_at, 'Mon FMDD, YYYY')
      using errcode = 'WB025';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$fn$;

drop trigger if exists job_parts_guard_trigger on public.job_parts;
create trigger job_parts_guard_trigger
  before insert or update or delete on public.job_parts
  for each row execute function public.job_parts_guard();

-- ---------------------------------------------------------------------------
-- the ledger learns one more word for where a deduction came from
--
-- source already says whether a row was typed by hand or deducted from a
-- sheet. A deduction from a job's own list is neither, and calling it
-- 'template' would make the ledger lie about a job that has no sheet.
-- ---------------------------------------------------------------------------
alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_source_check;

alter table public.inventory_transactions
  add constraint inventory_transactions_source_check
  check (source = any (array['manual', 'template', 'template_reversal', 'job_parts']));

-- ---------------------------------------------------------------------------
-- one resolver
--
-- Same shape as resolve_template_parts, so every caller reads the same columns
-- whichever half answered. An override row is always resolved: item_id is not
-- null by constraint, so the unresolved case belongs to pick lines only.
--
-- source says which half answered, because "why does this job not match its
-- sheet" is the first question anyone will ask of a job carrying an override.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_job_parts(p_job_id uuid)
returns table (
  line_id      uuid,
  line_type    text,
  pick_source  text,
  pick_category text,
  quantity     int,
  item_id      uuid,
  sku          text,
  item_name    text,
  item_variant text,
  unit_cost    numeric,
  line_cost    numeric,
  resolved     boolean,
  sort_order   int,
  source       text
)
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
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
         v_job.template_id, v_job.faucet_finish, v_job.ro_type, v_job.valve_type) r;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- the reservation sync reads the job, not the sheet
--
-- Only the three places that named resolve_template_parts change. The rest of
-- this function, including the refusal to guess a sheet by label, is as it
-- was. A job with an override and no template_id is now legitimate and is no
-- longer released as "template_changed", which is why the null template check
-- moved below the override check.
-- ---------------------------------------------------------------------------
create or replace function public.sync_job_reservations(p_job_id uuid)
returns json
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_job        public.jobs%rowtype;
  v_override   boolean;
  v_released   int := 0;
  v_open       int := 0;
  v_units      int := 0;
  v_unresolved int := 0;
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

  select exists (select 1 from public.job_parts jp where jp.job_id = p_job_id)
    into v_override;

  -- Named but not linked. This used to resolve silently by label. A job with
  -- its own parts list is exempt, because its sheet is not what it is claiming
  -- against and a stale label cannot mislead anybody about parts it is not
  -- using.
  if not v_override
     and v_job.template_id is null
     and exists (select 1 from public.system_templates t where t.label = v_job.system_template)
  then
    raise exception
      'This job names the build sheet "%" but is not linked to it, so its parts '
      'would be claimed and could never be printed on a work order. Set the '
      'template on the job rather than only its name.',
      v_job.system_template
      using errcode = 'WB012';
  end if;

  -- Nothing to claim against: no override rows and no sheet.
  if not v_override and v_job.template_id is null then
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
    from public.resolve_job_parts(p_job_id) r
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
  from public.resolve_job_parts(p_job_id) r
  where not r.resolved;

  return json_build_object(
    'job_id', p_job_id, 'template_id', v_job.template_id, 'open_lines', v_open,
    'released_lines', v_released, 'units_committed', v_units,
    'unresolved_lines', v_unresolved, 'from_job_parts', v_override
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- editing a job's own parts list resyncs its claim
--
-- The same rule the build sheet got, for the same reason: between the edit and
-- the install the committed and available figures would otherwise be wrong.
-- Row level rather than statement level, because a job's list is a handful of
-- rows edited one at a time, not a bulk statement over many sheets.
-- ---------------------------------------------------------------------------
create or replace function public.job_parts_resync()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_id uuid;
begin
  if tg_op = 'DELETE' then
    v_id := old.job_id;
  else
    v_id := new.job_id;
  end if;

  -- A cascade from a deleted job reaches here with nothing left to resync, and
  -- sync_job_reservations would raise on the missing row.
  if not exists (select 1 from public.jobs where id = v_id) then
    return null;
  end if;

  perform public.sync_job_reservations(v_id);
  return null;
end;
$fn$;

drop trigger if exists job_parts_resync_trigger on public.job_parts;
create trigger job_parts_resync_trigger
  after insert or update or delete on public.job_parts
  for each row execute function public.job_parts_resync();

-- ---------------------------------------------------------------------------
-- the install deducts what the job lists
--
-- The only change is which resolver names the parts, plus a note on the ledger
-- row saying so. The refusal on an unresolved line, the single batch, the one
-- row per item and the locked claim of parts_deducted_at are untouched.
--
-- An override with no rows cannot happen: the override only exists while rows
-- exist. An empty list therefore still means an empty sheet, and that is the
-- readiness report's problem to flag, not this function's to invent.
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
as $fn$
declare
  v_job        public.jobs%rowtype;
  v_template_id uuid;
  v_override   boolean;
  v_batch      int;
  v_unresolved text;
  v_inserted   int;
  v_cost       numeric;
begin
  if p_job_id is null then
    raise exception 'No job was given to install.' using errcode = 'WB001';
  end if;

  if p_payout is not null and p_payout < 0 then
    raise exception 'Installer pay cannot be negative.' using errcode = 'WB009';
  end if;

  select exists (select 1 from public.job_parts jp where jp.job_id = p_job_id)
    into v_override;

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

  -- A job listing its own parts needs no sheet at all. Only a job relying on
  -- one has to have one.
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

    -- keep the link when the job predates template_id and matched by label
    if v_job.template_id is distinct from v_template_id then
      update public.jobs set template_id = v_template_id where id = p_job_id;
    end if;
  end if;

  -- a partial deduction is worse than none, so refuse the whole thing
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

  select coalesce(sum(-t.quantity * coalesce(t.unit_cost_at_txn, 0)), 0)
    into v_cost
  from public.inventory_transactions t
  where t.job_id = p_job_id;

  return json_build_object(
    'job_id',         p_job_id,
    'batch',          v_batch,
    'lines_deducted', v_inserted,
    'parts_cost',     v_cost,
    'template',       case when v_override then 'this job''s own parts list' else v_job.system_template end,
    'from_job_parts', v_override
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- and the reversal has to find those rows again
--
-- revert_job_install reversed the batch by looking for source = 'template'.
-- A job deducted from its own list writes source = 'job_parts', so without
-- this the reversal would match nothing, report zero lines reversed, set
-- parts_deducted_at back to null and leave the stock off the shelf for good.
-- It would have looked like it worked.
--
-- Matching on the batch and the direction rather than on one source word, so
-- the next source added does not quietly break it again. Only the deduction
-- rows are negative, so the reversal rows cannot reverse themselves.
-- ---------------------------------------------------------------------------
create or replace function public.revert_job_install(
  p_job_id uuid,
  p_new_status text default 'scheduled'
)
returns json
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  v_job      public.jobs%rowtype;
  v_batch    int;
  v_reversed int;
begin
  if p_job_id is null then
    raise exception 'No job was given to reverse.' using errcode = 'WB001';
  end if;

  if p_new_status is null or p_new_status not in ('sold', 'scheduled') then
    raise exception 'Reversing an install must land on sold or scheduled, not "%".', coalesce(p_new_status, 'null')
      using errcode = 'WB005';
  end if;

  update public.jobs
  set status            = p_new_status,
      parts_deducted_at = null
  where id = p_job_id
    and parts_deducted_at is not null
  returning * into v_job;

  if not found then
    select * into v_job from public.jobs where id = p_job_id;

    if not found then
      raise exception 'That job no longer exists. Reload the jobs list.' using errcode = 'WB001';
    end if;

    raise exception 'This job has no deducted parts to reverse.' using errcode = 'WB006';
  end if;

  v_batch := v_job.parts_deduct_batch;

  insert into public.inventory_transactions
    (item_id, quantity, txn_type, job_id, unit_cost_at_txn, reference, note, source, deduct_batch)
  select
    t.item_id,
    -t.quantity,
    'return',
    t.job_id,
    t.unit_cost_at_txn,
    t.reference,
    format('Reversal of auto deduct batch %s', v_batch),
    'template_reversal',
    v_batch
  from public.inventory_transactions t
  where t.job_id       = p_job_id
    and t.deduct_batch = v_batch
    and t.source in ('template', 'job_parts')
    and t.quantity < 0;

  get diagnostics v_reversed = row_count;

  return json_build_object(
    'job_id',        p_job_id,
    'batch',         v_batch,
    'lines_reversed', v_reversed,
    'new_status',    p_new_status
  );
end;
$fn$;

-- ---------------------------------------------------------------------------
-- readiness counts the job's list
--
-- has_sheet and sheet_lines now answer "does this job have a parts list and
-- how long is it", which is the question the badge was always asking. A job
-- with an override has a list whether or not it has a sheet, so the two Custom
-- jobs stop reporting an empty sheet the moment parts are listed on them.
-- ---------------------------------------------------------------------------
create or replace function public.job_schedule_readiness(p_job_ids uuid[])
returns table (
  job_id           uuid,
  checked          boolean,
  has_sheet        boolean,
  sheet_lines      int,
  unresolved_lines int,
  short_items      int,
  short_units      int
)
language plpgsql
stable
set search_path = public, pg_temp
as $fn$
begin
  if p_job_ids is null or array_length(p_job_ids, 1) is null then
    return;
  end if;

  return query
  select
    j.id,
    (j.status not in ('installed', 'cancelled') and j.parts_deducted_at is null),
    (j.template_id is not null or o.override),
    coalesce(u.lines, 0),
    coalesce(u.unresolved, 0),
    coalesce(c.items, 0),
    coalesce(c.units, 0)
  from public.jobs j
  left join lateral (
    select exists (select 1 from public.job_parts jp where jp.job_id = j.id) as override
  ) o on true
  left join lateral (
    select
      count(*)::int                                   as items,
      coalesce(sum(greatest(k.shortfall, 0)), 0)::int as units
    from public.job_schedule_conflicts(j.id) k
  ) c on true
  left join lateral (
    select
      count(*) filter (where not r.resolved)::int as unresolved,
      count(*)::int                               as lines
    from public.resolve_job_parts(j.id) r
  ) u on true
  where j.id = any(p_job_ids);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- the view carries what the drawer has to edit
--
-- template_line_count becomes the job's line count rather than its sheet's,
-- for the same reason readiness changed. payment_type, water_source, notes and
-- payout_amount are added because the edit form has to load the values it is
-- about to save, and it reads this view like everything else does.
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
  coalesce(jp.line_count, bs.line_count, 0)::int as template_line_count,
  j.collected_by,
  j.valve_type,
  j.payment_type,
  j.water_source,
  j.notes,
  j.payout_amount,
  (jp.line_count is not null) as has_job_parts
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
) bs on bs.template_id = j.template_id
left join (
  select job_id, count(*) as line_count
  from public.job_parts
  group by job_id
) jp on jp.job_id = j.id;

grant select on public.job_margin to authenticated;

-- ---------------------------------------------------------------------------
-- prove it, inside a block that rolls back
--
-- A booked job gets its own parts list, and the claim must follow: the sheet's
-- claims released, the listed item claimed, the quantity followed on edit, and
-- the sheet's claims restored when the list is emptied again.
-- ---------------------------------------------------------------------------
do $$
declare
  v_job    uuid;
  v_item   uuid;
  v_row    uuid;
  v_before int;
  v_qty    int;
  v_lines  int;
begin
  select j.id into v_job
  from public.jobs j
  where j.status = 'scheduled' and j.parts_deducted_at is null
    and j.scheduled_date is not null and j.template_id is not null
  order by j.scheduled_date
  limit 1;

  if v_job is null then
    return;
  end if;

  select count(*)::int into v_before
  from public.job_reservations where job_id = v_job and released_at is null;

  select i.id into v_item
  from public.inventory_items i
  where i.active
    and not exists (
      select 1 from public.job_reservations jr
      where jr.job_id = v_job and jr.released_at is null and jr.item_id = i.id)
  order by i.created_at
  limit 1;

  if v_item is null then
    return;
  end if;

  begin
    insert into public.job_parts (job_id, item_id, quantity)
    values (v_job, v_item, 2)
    returning id into v_row;

    select count(*)::int into v_lines from public.resolve_job_parts(v_job);
    if v_lines <> 1 then
      raise exception 'an override of one row resolved to % lines', v_lines;
    end if;

    select quantity into v_qty
    from public.job_reservations
    where job_id = v_job and item_id = v_item and released_at is null;

    if v_qty is distinct from 2 then
      raise exception 'listing a part against the job did not claim 2 of it, got %', v_qty;
    end if;

    if exists (
      select 1 from public.job_reservations
      where job_id = v_job and released_at is null and item_id <> v_item
    ) then
      raise exception 'the sheet''s claims survived an override that does not name them';
    end if;

    update public.job_parts set quantity = 5 where id = v_row;

    select quantity into v_qty
    from public.job_reservations
    where job_id = v_job and item_id = v_item and released_at is null;

    if v_qty is distinct from 5 then
      raise exception 'a quantity change left the claim at % rather than 5', v_qty;
    end if;

    delete from public.job_parts where id = v_row;

    select count(*)::int into v_lines
    from public.job_reservations where job_id = v_job and released_at is null;

    if v_lines <> v_before then
      raise exception 'emptying the list left % claims rather than the % the sheet wants',
        v_lines, v_before;
    end if;

    raise exception 'PROOF_ROLLBACK';
  exception
    when others then
      if sqlerrm <> 'PROOF_ROLLBACK' then raise; end if;
  end;
end $$;

notify pgrst, 'reload schema';
